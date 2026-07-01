# Widget Federation + Codegen Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each `widgets/<dir>` into an independent pnpm package that builds as a Module Federation **remote** (its UI component only), consumed by the board **host**; make `react`/`react-dom`/`@reatom/core`/`@reatom/react`/`widget-runtime` true federation singletons; give every widget a standalone dev harness; and replace all hand-maintained widget lists (client catalog, `WidgetIconName` union + icon map, server registry, host remotes) with one build-time `codegen` step — with dev HMR, unit tests, typecheck, and e2e all green.

**Architecture:** This is Phased Rollout steps 3–4 of `2026-06-30-widget-build-isolation-design.md`. Because you (the design author) chose to honor the spec's "`widget-runtime` as a shared singleton" literally, Plan 1's `@widget-runtime/*` alias is first collapsed into a single **bare-package barrel** (`widget-runtime`) with an `exports` map — Module Federation shares by bare module request, so a bare barrel is what lets `widget-runtime` be one instance per page. `widget-sdk` becomes a bare package too but keeps **granular subpaths** (`widget-sdk/lib/utils`, `widget-sdk/ui/*`, `widget-sdk/reatom/*`) so shadcn keeps working there; it is stateless and stays out of the federation shared scope. Then each widget becomes a federation remote exposing `./ui`, the host consumes remotes resolved from `widgets/.ports.json` (dev) or `/widgets/<id>/` (prod), and `codegen` inlines each widget's static metadata into a **synchronous** catalog whose only async part is a `loadRemote('<id>/ui')` component loader.

**Tech Stack:** pnpm workspaces + catalog, Vite 8 (Rolldown) / Vitest 4, `@module-federation/vite` + `@module-federation/runtime`, `@vitejs/plugin-react`, TypeScript 6 (`moduleResolution: bundler`), React 19, `@reatom/core` + `@reatom/react`, Rspack 1 (server), Playwright, `jiti` (codegen), errore.

## Global Constraints

- **Federation shared config is identical on host and every remote**, produced by one factory (`federationShared()`). Singletons (`singleton: true, strictVersion: true`): `react`, `react-dom`, `@reatom/core`, `@reatom/react`, `widget-runtime`. A version mismatch must fail the build (see Error Handling). `widget-sdk` is **not** in the shared scope — it is consumed through subpaths (see next bullet) that a single `widget-sdk` share entry could not match, and every part of it is stateless (correctness comes from the `@reatom/react` singleton), so it is compiled per remote.
- **`widget-runtime` is a bare-package barrel** (`import … from 'widget-runtime'`), resolved via its `exports` map to `src/index.ts` — this is what lets Module Federation share it as one instance. Test-only entrypoints stay explicit subpaths (`widget-runtime/timer/fakes`, `widget-runtime/storage/test/fakes`).
- **`widget-sdk` is a bare-package with stable subpaths**, not a single barrel: `widget-sdk/lib/utils`, `widget-sdk/ui/<name>`, `widget-sdk/reatom/<name>`, `widget-sdk/define-widget-client`, `widget-sdk/vite`, `widget-sdk/test-setup`. The subpaths (not aliases) are what shadcn's `components.json` and generated imports resolve against, so they must stay stable.
- **shadcn keeps working in `widget-sdk`.** `widget-sdk` carries its own `components.json` (shared-UI-package flavor: `#components`/`#lib/utils` aliases resolved by `package.json#imports`), so `shadcn add` run there places components in `src/ui` importing `cn` from `#lib/utils`. `client/components.json` points `utils` at `widget-sdk/lib/utils` (its real home since Plan 1). Because widget UIs become separate remote builds, the board's Tailwind must still emit the utility classes shadcn components use — the board CSS `@source`s `widget-sdk/src` and `widgets/*/ui`.
- **`dev: { remoteHmr: true }` on every federation config** — host *and* every remote. Setting it only on the host is not enough (confirmed by the design's 2026-07-01 spike).
- **Package names are `widgets-<dir>`** (e.g. `widgets-clock`); the federation **remote name = widget id = directory name** (`clock`, `ofelia-poop-duty`). Remotes expose exactly `{ './ui': './ui/expose.ts' }`.
- **Production build base is `/widgets/<id>/`** for each remote (`base` applied only in `command === 'build'`; dev/preview keep `base: '/'`… except e2e preview, see Task 8).
- **All generated files are gitignored except `widgets/.ports.json`**, which is committed. Dev ports never change for an existing widget when others are added/removed (`max(existing)+1`, starting 5180).
- **The catalog stays synchronous**: metadata is codegen-inlined literals; only the UI component crosses the federation boundary, and only at mount.
- **No behavior change to Clock or Ofelia**; every exported React component stays wrapped in `reatomMemo`; errore stays (errors as values, never thrown for control flow).
- Shared dependency versions come from the pnpm `catalog` (`catalog:`) wherever a catalog entry exists.
- Commit after every task with the existing message style. Do not push. Do not stage unrelated changes.
- **In scope (steps 3–4):** per-widget packages, federation host+remotes, dev harness, codegen, synchronous catalog, `.ports.json`, per-widget vitest, `pnpm dev`/`dev:server` scripts, e2e kept green via a per-widget preview proxy.
- **Out of scope (deferred to Plan 3 / steps 5–6):** `pnpm build` widgets-then-client orchestration, Dockerfile/nginx same-origin `/widgets/<id>/` serving, PWA precache of remotes, reconciling `codeSplitting.groups` with `shared`, Pi build-timeout re-check, and the `AGENTS.md`/`CLAUDE.md` widget-path doc fixes.

---

## File Structure

Target layout after this plan (new/renamed files marked):

```text
scripts/
  codegen.ts                    # NEW: discovers widgets/*, emits catalog/icons/server-list, updates .ports.json
  codegen.test.ts               # NEW: unit tests for the pure emitters + port assignment
widget-runtime/
  package.json                  # add `exports` map (bare barrel + test subpaths)
  src/
    index.ts                    # NEW: bare-package barrel (`widget-runtime`)
    ...(existing storage/, timer/, tier.ts, types.ts, theme.ts, widget-api.ts unchanged)
widget-sdk/
  package.json                  # add `exports` (subpaths) + `imports` (#components/#lib for shadcn)
  components.json               # NEW: shadcn shared-UI-package config
  src/
    index.ts                    # NEW: light `.` barrel (reatom + defineWidgetClient + cn; no CSS UI)
    define-widget-client.ts     # icon type loosened to string (see Task 7)
    lib/utils.ts                # cn — shadcn `utils` target (widget-sdk/lib/utils)
    ui/*.tsx                     # shadcn ui components (tabs, WidgetControls, future adds)
    reatom/*.ts                  # reatomMemo, useAtomValue
    test/widget-setup.ts        # NEW: shared vitest jsdom setup for widgets
    vite/
      index.ts                  # NEW: config barrel (`widget-sdk/vite`)
      vite-dev-config.ts        # MOVED from ../vite-dev-config.ts (apiProxy)
      federation-shared.ts      # NEW: federationShared()
      widget-vite-config.ts     # NEW: defineWidgetViteConfig() + defineWidgetVitestConfig()
      widget-remotes.ts         # NEW: readWidgetPort(s), widgetRemotes(), previewWidgetsProxy()
widgets/
  .ports.json                   # NEW (committed): { "clock": 5180, "ofelia-poop-duty": 5181 }
  clock/
    package.json                # NEW: name "widgets-clock"
    vite.config.ts              # NEW: defineWidgetViteConfig(import.meta.dirname)
    vitest.config.ts            # NEW: defineWidgetVitestConfig(import.meta.dirname)
    tsconfig.json               # NEW
    index.html                  # NEW: standalone harness page
    dev/
      main.tsx                  # NEW: mounts <HarnessApp/>
      harness.tsx               # NEW: HarnessApp + harnessProps() (testable)
      harness.test.tsx          # NEW: harness smoke test
    ui/expose.ts                # NEW: `export { Clock as default } from './Clock'`
    client.ts / server.ts       # add `export default`
  ofelia-poop-duty/             # same shape (name "widgets-ofelia-poop-duty")
  package.json                  # DELETED (umbrella package removed)
client/
  vite.config.ts                # functional config; federation host; drop @widget-*/@widgets aliases
  components.json               # fix shadcn `utils` alias → widget-sdk/lib/utils
  src/app/global.css            # add @source for widget-sdk/src + widgets/*/ui (Tailwind content)
  src/widget-registry/model/
    registry.ts                 # re-exports generated catalog + icons; keeps find/preload
    widget-catalog.generated.ts # GENERATED (gitignored)
    widget-icons.generated.ts   # GENERATED (gitignored)
  src/board/ui/AddWidgetMenu.tsx# uses generated WIDGET_ICONS
server/
  src/widgets/
    production-registry.ts      # consumes generated list
    widget-server-list.generated.ts # GENERATED (gitignored)
```

**Import-rewrite tables** (applied by `sed`/editor across the listed roots; longer specifiers first so a prefix rule never eats a more specific one):

*Table R — `@widget-runtime/*` → bare barrel* (roots: `client/src`, `widgets`, `widget-sdk`):

| Old specifier | New specifier |
| --- | --- |
| `@widget-runtime/storage/test/fakes` | `widget-runtime/storage/test/fakes` |
| `@widget-runtime/timer/fakes` | `widget-runtime/timer/fakes` |
| `@widget-runtime/storage/reatom` | `widget-runtime` |
| `@widget-runtime/storage/types` | `widget-runtime` |
| `@widget-runtime/storage` | `widget-runtime` |
| `@widget-runtime/widget-api` | `widget-runtime` |
| `@widget-runtime/timer/server-time` | `widget-runtime` |
| `@widget-runtime/tier` | `widget-runtime` |
| `@widget-runtime/theme` | `widget-runtime` |
| `@widget-runtime/types` | `widget-runtime` |

*Table S — `@widget-sdk/*` → bare-package subpaths (drop the `@`, keep the path)* (roots: `client/src`, `widgets`):

| Old specifier | New specifier |
| --- | --- |
| `@widget-sdk/define-widget-client` | `widget-sdk/define-widget-client` |
| `@widget-sdk/reatom/reatom-memo` | `widget-sdk/reatom/reatom-memo` |
| `@widget-sdk/reatom/use-atom-value` | `widget-sdk/reatom/use-atom-value` |
| `@widget-sdk/ui/WidgetControls` | `widget-sdk/ui/WidgetControls` |
| `@widget-sdk/ui/tabs` | `widget-sdk/ui/tabs` |
| `@widget-sdk/lib/utils` | `widget-sdk/lib/utils` |

Notes: `widget-runtime` collapses to a **single bare barrel** (Table R) because it must be a federation singleton. `widget-sdk` keeps its **subpaths** (Table S just drops the `@`) because those subpaths are shadcn's resolution targets and stay stable across `shadcn add`. Since Table R can turn several `@widget-runtime/*` lines in one file into repeated `from 'widget-runtime'` imports, and `oxlint`'s `import/no-duplicates` is not in the `correctness` category, those repeats are legal — merge by hand only where trivial (Table S produces no duplicates). `widget-runtime`'s and `widget-sdk`'s **internal** imports are relative and are not touched. Type-only imports (`client/src/shared/theme/types.ts` → `@widget-runtime/theme`; `widget-sdk/src/define-widget-client.ts` → `@widget-runtime/{tier,types}`) still map per the tables (erased at runtime).

---

## Task 1: Barrel-ize `widget-runtime` into a bare-package singleton

**Files:**
- Create: `widget-runtime/src/index.ts`
- Modify: `widget-runtime/package.json` (`exports`), `widget-runtime/tsconfig.json`, `widget-runtime/vitest.config.ts`
- Modify (Table R, runtime rows only): every `@widget-runtime/*` import under `client/src`, `widgets`, `widget-sdk`
- Modify: `client/vite.config.ts`, `client/tsconfig.json`, `widget-sdk/tsconfig.json`, `widget-sdk/vitest.config.ts` (drop the `@widget-runtime` alias; add nothing — resolution is now via the package `exports`)

**Interfaces:**
- Produces: bare package `widget-runtime` resolving to `src/index.ts`, exporting the full runtime surface (`makeWidgetStorage`, `WidgetStorage`, `ScopedStorage`, `MakeWidgetStorageOptions`, `makeScopedStorage`, `StorageApi`, `StorageListener`, the reatom storage bindings, `makeWidgetApi`, `WidgetApiError`, `MakeWidgetApiOptions`, `WidgetTier`, `TierConfig`, `DEFAULT_TIERS`, `resolveTier`, `ResolvedTheme`, `getServerTime`, `createServerTime`, `ServerTime`, `WidgetRuntimeProps`, `WidgetComponent`, `WidgetComponentModule`, `WidgetLoader`, `WidgetMode`); test subpaths `widget-runtime/storage/test/fakes`, `widget-runtime/timer/fakes`.

- [ ] **Step 1: Baseline green**

Run: `pnpm install && pnpm typecheck && pnpm test && pnpm build`
Expected: all pass. Record as baseline.

- [ ] **Step 2: Write the barrel** — `widget-runtime/src/index.ts`

```ts
export * from './types'
export * from './theme'
export * from './tier'
export * from './widget-api'
export * from './storage'
export * from './storage/types'
export * from './storage/reatom'
export * from './timer/server-time'
```

(Only externally-consumed modules are re-exported. `storage/{scope,subscribe-key,validate,db,...}` and `timer/http-time` stay internal — reachable relatively but not part of the public barrel. Test fakes are intentionally excluded so they never reach the runtime bundle.)

- [ ] **Step 3: Add the `exports` map** to `widget-runtime/package.json` (place after `"type": "module"`):

```json
  "exports": {
    ".": "./src/index.ts",
    "./storage/test/fakes": "./src/storage/test/fakes.ts",
    "./timer/fakes": "./src/timer/fakes.ts"
  },
```

- [ ] **Step 4: Fix `widget-runtime`'s own configs to resolve itself relatively (drop the self-alias)**

In `widget-runtime/tsconfig.json` `paths`, remove `"@widget-runtime/*": ["./src/*"]` (keep `@shared`). The package's own tests import relatively, so no self-alias is needed. In `widget-runtime/vitest.config.ts` `resolve.alias`, remove the `'@widget-runtime'` entry (keep `@shared`).

- [ ] **Step 5: Rewrite `@widget-runtime/*` consumers (Table R)**

Find: `git grep -l "@widget-runtime/" -- client/src widgets widget-sdk`
Apply Table R in the listed order (test-fakes rows first, then the collapse rows). Confirm the only remaining `@widget-runtime/` references are the two test subpaths:
`git grep -n "@widget-runtime/" -- client/src widgets widget-sdk` → only `…/storage/test/fakes` and `…/timer/fakes`.

- [ ] **Step 6: Drop the `@widget-runtime` alias from the board + widget-sdk configs**

- `client/vite.config.ts`: remove `'@widget-runtime': resolve(__dirname, '../widget-runtime/src')` from `resolve.alias`.
- `client/tsconfig.json`: remove `"@widget-runtime/*": ["../widget-runtime/src/*"]` from `paths`.
- `widget-sdk/tsconfig.json`: remove `"@widget-runtime/*": ["../widget-runtime/src/*"]` from `paths`.
- `widget-sdk/vitest.config.ts`: remove the `'@widget-runtime'` alias.

Resolution now flows through the workspace symlink + `exports` (every consumer already declares `widget-runtime: "workspace:*"`).

- [ ] **Step 7: Verify no behavior change**

Run: `pnpm install && pnpm --filter widget-runtime test && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. `pnpm build` proves Vite resolves the bare `widget-runtime` package via `exports` (not the removed alias).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(widgets): make widget-runtime a bare-package barrel"
```

---

## Task 2: Make `widget-sdk` a bare package with shadcn-compatible subpaths

**Files:**
- Create: `widget-sdk/src/index.ts`, `widget-sdk/src/vite/index.ts`, `widget-sdk/src/test/widget-setup.ts`, `widget-sdk/components.json`
- Move: `widget-sdk/src/vite-dev-config.ts` → `widget-sdk/src/vite/vite-dev-config.ts`; `widget-sdk/src/vite-dev-config.test.ts` → `widget-sdk/src/vite/vite-dev-config.test.ts`
- Modify: `widget-sdk/package.json` (`exports` + `imports` + devDep), `client/components.json`, `client/src/app/global.css`
- Modify (Table S): every `@widget-sdk/*` import under `client/src`, `widgets`
- Modify: `client/vite.config.ts` (its `apiProxy` import), `client/tsconfig.json`, `widget-sdk/vitest.config.ts`

**Interfaces:**
- Consumes: `widget-runtime` from Task 1.
- Produces: bare package `widget-sdk` with stable subpaths `widget-sdk/lib/utils` (`cn`), `widget-sdk/ui/tabs`, `widget-sdk/ui/WidgetControls`, `widget-sdk/reatom/reatom-memo`, `widget-sdk/reatom/use-atom-value`, `widget-sdk/define-widget-client`, `widget-sdk/vite`, `widget-sdk/test-setup`, plus a light `.` barrel; a `components.json` that makes `widget-sdk` a shadcn shared-UI package, and a fixed `client/components.json` (`utils` → `widget-sdk/lib/utils`).

- [ ] **Step 1: Move the dev-config into `src/vite/`**

```bash
mkdir -p widget-sdk/src/vite widget-sdk/src/test
git mv widget-sdk/src/vite-dev-config.ts widget-sdk/src/vite/vite-dev-config.ts
git mv widget-sdk/src/vite-dev-config.test.ts widget-sdk/src/vite/vite-dev-config.test.ts
```

The moved `vite-dev-config.ts` needs no edits (it imports nothing relative). The moved test imports `./vite-dev-config` — unchanged.

- [ ] **Step 2: Write the light `.` barrel** — `widget-sdk/src/index.ts`

Convenience only — app code imports subpaths (Table S). Keep the CSS-module UI *out* of the barrel so importing bare `widget-sdk` never drags a `.module.css` into a Node context:

```ts
export * from './reatom/reatom-memo'
export * from './reatom/use-atom-value'
export * from './define-widget-client'
export * from './lib/utils'
```

- [ ] **Step 3: Write the config barrel** — `widget-sdk/src/vite/index.ts`

```ts
export * from './vite-dev-config'
export * from './federation-shared'
export * from './widget-vite-config'
export * from './widget-remotes'
```

(The `federation-shared`, `widget-vite-config`, and `widget-remotes` modules are created in Task 3; add the re-exports now — the file will not typecheck until Task 3, which is fine because nothing imports `widget-sdk/vite` until then. If you prefer a green intermediate, add the three `export *` lines in Task 3 instead. This plan adds them in Task 3.) For **this** task write only:

```ts
export * from './vite-dev-config'
```

- [ ] **Step 4: Write the shared widget vitest setup** — `widget-sdk/src/test/widget-setup.ts`

Copy the polyfill blocks from `client/src/vitest.setup.ts` verbatim (jsdom globals widgets rely on): the `@testing-library/jest-dom/vitest` import, the `BroadcastChannel` polyfill, the `EventSource` polyfill, the `node:vm` Temporal block, the `ResizeObserverMock` block, and the `matchMedia` block. Add `fake-indexeddb/auto` at the top so the storage layer has IndexedDB:

```ts
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'

// ...verbatim BroadcastChannel polyfill block...
// ...verbatim EventSource polyfill block...
// ...verbatim node:vm Temporal block...
// ...verbatim ResizeObserverMock block...
// ...verbatim matchMedia block...
```

- [ ] **Step 5: Add the `exports` + `imports` maps + test devDep** to `widget-sdk/package.json`

Add after `"type": "module"`:

```json
  "exports": {
    ".": "./src/index.ts",
    "./lib/utils": "./src/lib/utils.ts",
    "./ui/*": "./src/ui/*.tsx",
    "./reatom/*": "./src/reatom/*.ts",
    "./define-widget-client": "./src/define-widget-client.ts",
    "./vite": "./src/vite/index.ts",
    "./test-setup": "./src/test/widget-setup.ts"
  },
  "imports": {
    "#lib/utils": "./src/lib/utils.ts",
    "#lib/*": "./src/lib/*.ts",
    "#components/*": "./src/ui/*.tsx",
    "#hooks/*": "./src/hooks/*.ts"
  },
```

`exports` are the **outward** subpaths the board/widgets/shadcn import (`widget-sdk/lib/utils`, `widget-sdk/ui/tabs`, `widget-sdk/reatom/reatom-memo`, …). `imports` are the **inward** `#`-specifiers shadcn generates for components that live *inside* widget-sdk (`#lib/utils`, `#components/*`). Add to `devDependencies` (version from `client/package.json`): `"fake-indexeddb": "^6.2.5"`. (`@testing-library/jest-dom` and `jsdom` are already present.)

- [ ] **Step 6: Add widget-sdk's shadcn config** — `widget-sdk/components.json`

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "radix-nova",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "../client/src/app/global.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "#components",
    "ui": "#components",
    "utils": "#lib/utils",
    "lib": "#lib",
    "hooks": "#hooks"
  },
  "registries": {}
}
```

This mirrors the shadcn monorepo "shared UI package" model: running `pnpm --filter widget-sdk dlx shadcn@latest add <c>` places the component in `src/ui/` (`#components`), importing `cn` from `#lib/utils` — both resolved by the `imports` map from Step 5. `style`/`iconLibrary` match `client/components.json`; the Tailwind `css` points at the board's shared theme (`client/src/app/global.css`).

- [ ] **Step 7: Fix the client's shadcn `utils` alias** — `client/components.json`

`cn` moved into widget-sdk in Plan 1, so `"utils": "@/lib/utils"` is stale (that file no longer exists). Change it so client-side `shadcn add` imports `cn` from its real home:

```json
  "aliases": {
    "components": "@/components",
    "utils": "widget-sdk/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
```

(The client keeps generating its own primitives into `@/components/ui`; only the `cn` source moves to the shared package. Shared widget primitives like `tabs` live in widget-sdk and are added there instead.)

- [ ] **Step 8: Keep federated widget classes in the board's Tailwind build** — `client/src/app/global.css`

Once widget UIs are separate remote builds they leave the board's module graph, so Tailwind stops seeing the utility classes their shadcn components use (e.g. `tabs`' `bg-muted`, `text-foreground`). Add explicit content sources right after the Tailwind import so the board's global stylesheet still emits those classes (the `*/ui` glob skips `node_modules`/`dist`):

```css
@import 'tailwindcss';
@source '../../../widget-sdk/src';
@source '../../../widgets/*/ui';
```

- [ ] **Step 9: Rewrite `@widget-sdk/*` consumers (Table S — drop the `@`, keep the path)**

Find: `git grep -l "@widget-sdk/" -- client/src widgets`
Apply Table S. Confirm nothing remains:
`git grep -n "@widget-sdk/" -- client/src widgets` → empty.

- [ ] **Step 10: Update the board's `apiProxy` import + drop the `@widget-sdk` alias**

- `client/vite.config.ts`: change `import { apiProxy } from '../widget-sdk/src/vite-dev-config'` → `import { apiProxy } from 'widget-sdk/vite'`; remove `'@widget-sdk': resolve(__dirname, '../widget-sdk/src')` from `resolve.alias`.
- `client/tsconfig.json`: remove `"@widget-sdk/*": ["../widget-sdk/src/*"]` from `paths`.
- `widget-sdk/vitest.config.ts`: remove the `'@widget-sdk'` alias (the package self-resolves via `exports`). `@widget-runtime` was already removed in Task 1, so only `@shared` should remain.

- [ ] **Step 11: Verify no behavior change + shadcn coherence**

Run: `pnpm install && pnpm --filter widget-sdk test && pnpm typecheck && pnpm test && pnpm build`
Expected: all green — the subpath `exports` resolve for every `widget-sdk/*` consumer (client ui primitives importing `cn` from `widget-sdk/lib/utils`, ofelia's `MobileTabs` importing `widget-sdk/ui/tabs`, etc.), and both `components.json` files are valid JSON. Sanity-check shadcn resolution without mutating files: `pnpm --filter widget-sdk dlx shadcn@latest add label --dry-run 2>&1 | head` (or, if the installed CLI lacks `--dry-run`, just confirm `widget-sdk/components.json` loads by running the CLI with no args). Do **not** run a real `add` here — that would rewrite files outside this task's scope.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor(widgets): make widget-sdk a bare-package with shadcn subpaths"
```

---

## Task 3: Federation config factories in `widget-sdk/vite`

**Files:**
- Create: `widget-sdk/src/vite/federation-shared.ts` + `federation-shared.test.ts`
- Create: `widget-sdk/src/vite/widget-remotes.ts` + `widget-remotes.test.ts`
- Create: `widget-sdk/src/vite/widget-vite-config.ts`
- Modify: `widget-sdk/src/vite/index.ts` (add the three `export *` lines)
- Modify: `widget-sdk/package.json` (add federation/vite build deps)

**Interfaces:**
- Produces (all via `widget-sdk/vite`): `federationShared()`; `readWidgetPorts(file)`, `readWidgetPort(id, file)`, `widgetRemotes({ command, portsFile })`, `previewWidgetsProxy(portsFile)`; `defineWidgetViteConfig(widgetDir)`, `defineWidgetVitestConfig(widgetDir)`.

- [ ] **Step 1: Add build deps to `widget-sdk`**

Run:
```bash
pnpm --filter widget-sdk add -D @module-federation/vite@^1.16.12 @vitejs/plugin-react@^6.0.2 vite@^8.0.16
```
Expected: the three appear in `widget-sdk/devDependencies`.

- [ ] **Step 2: Write the failing shared-config test** — `widget-sdk/src/vite/federation-shared.test.ts`

```ts
import { describe, expect, it } from 'vitest'

import { federationShared } from './federation-shared'

describe('federationShared', () => {
  it('marks the five runtime deps as strict singletons', () => {
    const shared = federationShared()
    for (const dep of ['react', 'react-dom', '@reatom/core', '@reatom/react', 'widget-runtime']) {
      expect(shared[dep]).toMatchObject({ singleton: true, strictVersion: true })
    }
  })

  it('does not put widget-sdk in the shared scope (it is consumed via subpaths)', () => {
    expect(federationShared()['widget-sdk']).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run it (fails, module missing)**

Run: `pnpm --filter widget-sdk test -- federation-shared`
Expected: FAIL — `Cannot find module './federation-shared'`.

- [ ] **Step 4: Implement** — `widget-sdk/src/vite/federation-shared.ts`

```ts
export type SharedConfig = Record<string, { singleton: boolean; strictVersion?: boolean }>

/** Identical on the board host and every widget remote. `strictVersion` turns a
 *  duplicated-copy mismatch into a build failure instead of a silent second copy.
 *  widget-sdk is intentionally absent: it is consumed through subpaths (shadcn
 *  compatibility), which a single `widget-sdk` share entry cannot match, and it is
 *  stateless — correctness comes from the `@reatom/react` singleton above. */
export function federationShared(): SharedConfig {
  const singleton = { singleton: true, strictVersion: true }
  return {
    react: singleton,
    'react-dom': singleton,
    '@reatom/core': singleton,
    '@reatom/react': singleton,
    'widget-runtime': singleton,
  }
}
```

- [ ] **Step 5: Write the failing remotes/ports test** — `widget-sdk/src/vite/widget-remotes.test.ts`

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { previewWidgetsProxy, readWidgetPort, widgetRemotes } from './widget-remotes'

function portsFileWith(json: Record<string, number>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ports-'))
  const file = join(dir, '.ports.json')
  writeFileSync(file, JSON.stringify(json))
  return file
}

describe('widget-remotes', () => {
  const file = portsFileWith({ clock: 5180, 'ofelia-poop-duty': 5181 })

  it('reads a widget port', () => {
    expect(readWidgetPort('ofelia-poop-duty', file)).toBe(5181)
  })

  it('serves dev remotes from localhost ports', () => {
    expect(widgetRemotes({ command: 'serve', portsFile: file }).clock).toEqual({
      type: 'module',
      name: 'clock',
      entry: 'http://localhost:5180/remoteEntry.js',
      entryGlobalName: 'clock',
    })
  })

  it('builds prod remotes from same-origin paths', () => {
    expect(widgetRemotes({ command: 'build', portsFile: file }).clock.entry).toBe(
      '/widgets/clock/remoteEntry.js',
    )
  })

  it('maps each widget id to a preview proxy target', () => {
    expect(previewWidgetsProxy(file)['/widgets/ofelia-poop-duty']).toEqual({
      target: 'http://localhost:5181',
      changeOrigin: false,
    })
  })
})
```

- [ ] **Step 6: Run it (fails)**

Run: `pnpm --filter widget-sdk test -- widget-remotes`
Expected: FAIL — module missing.

- [ ] **Step 7: Implement** — `widget-sdk/src/vite/widget-remotes.ts`

```ts
import { readFileSync } from 'node:fs'

export type WidgetPorts = Record<string, number>

export function readWidgetPorts(portsFile: string): WidgetPorts {
  try {
    return JSON.parse(readFileSync(portsFile, 'utf8')) as WidgetPorts
  } catch {
    return {}
  }
}

export function readWidgetPort(id: string, portsFile: string): number {
  const port = readWidgetPorts(portsFile)[id]
  if (port == null) {
    throw new Error(`No dev port for widget "${id}" in ${portsFile}. Run \`pnpm codegen\`.`)
  }
  return port
}

export type FederationRemote = {
  type: 'module'
  name: string
  entry: string
  entryGlobalName: string
}

export function widgetRemotes(options: {
  command: 'build' | 'serve'
  portsFile: string
}): Record<string, FederationRemote> {
  const remotes: Record<string, FederationRemote> = {}
  for (const [id, port] of Object.entries(readWidgetPorts(options.portsFile))) {
    const entry =
      options.command === 'serve'
        ? `http://localhost:${port}/remoteEntry.js`
        : `/widgets/${id}/remoteEntry.js`
    remotes[id] = { type: 'module', name: id, entry, entryGlobalName: id }
  }
  return remotes
}

/** e2e-only: the board preview proxies each `/widgets/<id>/**` to that widget's
 *  own `vite preview` server so remotes resolve same-origin without nginx (Plan 3). */
export function previewWidgetsProxy(
  portsFile: string,
): Record<string, { target: string; changeOrigin: boolean }> {
  const proxy: Record<string, { target: string; changeOrigin: boolean }> = {}
  for (const [id, port] of Object.entries(readWidgetPorts(portsFile))) {
    proxy[`/widgets/${id}`] = { target: `http://localhost:${port}`, changeOrigin: false }
  }
  return proxy
}
```

- [ ] **Step 8: Implement the widget config factories** — `widget-sdk/src/vite/widget-vite-config.ts`

```ts
import { basename, resolve } from 'node:path'

import { federation } from '@module-federation/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { defineConfig as defineVitestConfig } from 'vitest/config'

import { federationShared } from './federation-shared'
import { apiProxy } from './vite-dev-config'
import { readWidgetPort } from './widget-remotes'

/** Federation remote + standalone dev/preview server for one widget package. */
export function defineWidgetViteConfig(widgetDir: string) {
  const id = basename(widgetDir)
  const port = readWidgetPort(id, resolve(widgetDir, '..', '.ports.json'))
  return defineConfig(({ command }) => ({
    base: command === 'build' ? `/widgets/${id}/` : '/',
    plugins: [
      federation({
        name: id,
        filename: 'remoteEntry.js',
        exposes: { './ui': './ui/expose.ts' },
        shared: federationShared(),
        dev: { remoteHmr: true },
        manifest: false,
      }),
      react(),
    ],
    resolve: { alias: { '@shared': resolve(widgetDir, '..', '..', 'shared') } },
    server: { port, strictPort: true, origin: `http://localhost:${port}`, proxy: apiProxy() },
    preview: { port, strictPort: true, proxy: apiProxy() },
  }))
}

/** Per-widget vitest (jsdom + shared setup). Kept separate from the federation
 *  vite config so the federation plugin never runs during tests. */
export function defineWidgetVitestConfig(widgetDir: string) {
  return defineVitestConfig({
    resolve: { alias: { '@shared': resolve(widgetDir, '..', '..', 'shared') } },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['widget-sdk/test-setup'],
      execArgv: ['--harmony-temporal'],
    },
  })
}
```

- [ ] **Step 9: Wire the config barrel** — replace `widget-sdk/src/vite/index.ts` with:

```ts
export * from './vite-dev-config'
export * from './federation-shared'
export * from './widget-vite-config'
export * from './widget-remotes'
```

- [ ] **Step 10: Verify**

Run: `pnpm --filter widget-sdk test && pnpm typecheck`
Expected: `federation-shared` + `widget-remotes` suites PASS; typecheck green (`widget-sdk/vite` now fully typechecks; nothing consumes the factories yet).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(widgets): add federation shared + widget vite config factories"
```

---

## Task 4: Convert `clock` into the `widgets-clock` federation remote

**Files:**
- Create: `widgets/clock/package.json`, `widgets/clock/vite.config.ts`, `widgets/clock/vitest.config.ts`, `widgets/clock/tsconfig.json`, `widgets/clock/ui/expose.ts`, `widgets/clock/index.html`, `widgets/clock/dev/main.tsx`, `widgets/clock/dev/harness.tsx`, `widgets/clock/dev/harness.test.tsx`
- Modify: `widgets/clock/client.ts`, `widgets/clock/server.ts` (add `export default`)
- Modify: `pnpm-workspace.yaml` (add `widgets/*`; keep `widgets` until Task 5)

**Interfaces:**
- Consumes: `defineWidgetViteConfig`/`defineWidgetVitestConfig` (Task 3).
- Produces: workspace package `widgets-clock`; a built remote `widgets/clock/dist/remoteEntry.js` exposing `./ui`; a standalone harness; `widgets/clock/client.ts` default export = the client definition, `widgets/clock/server.ts` default export = the server definition.

- [ ] **Step 1: Add the `widgets/*` glob** to `pnpm-workspace.yaml` `packages:` (leave the existing `widgets` entry for now; Task 5 removes it):

```yaml
packages:
  - client
  - server
  - shared
  - widgets
  - widgets/*
  - widget-runtime
  - widget-sdk
```

- [ ] **Step 2: Write `widgets/clock/package.json`**

```json
{
  "name": "widgets-clock",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@reatom/core": "catalog:",
    "lucide-react": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "widget-runtime": "workspace:*",
    "widget-sdk": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@module-federation/vite": "^1.16.12",
    "@testing-library/react": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "^6.0.2",
    "vite": "^8.0.16",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 3: Write `widgets/clock/vite.config.ts` and `widgets/clock/vitest.config.ts`**

`vite.config.ts`:
```ts
import { defineWidgetViteConfig } from 'widget-sdk/vite'

export default defineWidgetViteConfig(import.meta.dirname)
```

`vitest.config.ts`:
```ts
import { defineWidgetVitestConfig } from 'widget-sdk/vite'

export default defineWidgetVitestConfig(import.meta.dirname)
```

- [ ] **Step 4: Write `widgets/clock/tsconfig.json`**

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
      "@shared/*": ["../../shared/*"]
    }
  },
  "include": ["."]
}
```

- [ ] **Step 5: Add the `export default` for codegen + harness**

`widgets/clock/client.ts` — append after the existing `export const clockWidget = …`:
```ts
export default clockWidget
```

`widgets/clock/server.ts` — append after the existing `export const clockServer = …`:
```ts
export default clockServer
```

(The named exports stay for backward compat during the transition; the board stops importing them in Tasks 6–7.)

- [ ] **Step 6: Write the exposed UI module** — `widgets/clock/ui/expose.ts`

```ts
export { Clock as default } from './Clock'
```

(`loadRemote('clock/ui')` resolves this module; its `default` is the component, matching `WidgetComponentModule`.)

- [ ] **Step 7: Write the standalone harness**

`widgets/clock/dev/harness.tsx`:
```tsx
import { makeWidgetApi, makeWidgetStorage } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk'

import Widget from '../ui/expose'

const DEV_ID = 'clock'

export function harnessProps(): WidgetRuntimeProps {
  return {
    instanceId: `dev:${DEV_ID}`,
    typeId: DEV_ID,
    mode: 'large',
    tier: 'standard',
    theme: 'light',
    requestFullscreen: () => {},
    requestClose: () => {},
    requestDelete: () => {},
    reportError: (error) => console.warn('[harness]', error),
    storage: makeWidgetStorage({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
    api: makeWidgetApi({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
  }
}

export const HarnessApp = reatomMemo(() => <Widget {...harnessProps()} />, 'ClockHarness')
```

`widgets/clock/dev/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'

import { HarnessApp } from './harness'

const root = document.getElementById('root')
if (root) createRoot(root).render(<HarnessApp />)
```

`widgets/clock/index.html`:
```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>clock — standalone</title>
  </head>
  <body>
    <div id="root" style="width: 100vw; height: 100vh"></div>
    <script type="module" src="/dev/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Write the harness smoke test** — `widgets/clock/dev/harness.test.tsx`

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HarnessApp, harnessProps } from './harness'

describe('clock harness', () => {
  it('builds real runtime props bound to the dev instance', () => {
    const props = harnessProps()
    expect(props.typeId).toBe('clock')
    expect(typeof props.storage.instance.client.get).toBe('function')
    expect(typeof props.api.invoke).toBe('function')
  })

  it('renders the widget standalone', () => {
    render(<HarnessApp />)
    expect(screen.getByText(/:/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 9: Install and run the widget's own suite + isolated build**

Run:
```bash
pnpm install
pnpm --filter widgets-clock test
pnpm --filter widgets-clock build
```
Expected: install links `widgets-clock`; its vitest runs `ui/Clock.test.tsx` + `dev/harness.test.tsx` (and any model tests) green via `widget-sdk/test-setup`; `build` emits `widgets/clock/dist/remoteEntry.js` plus hashed chunks with asset URLs under `/widgets/clock/` (Success criterion: a widget builds without the client build).

- [ ] **Step 10: Confirm the isolated artifact**

Run: `git status --porcelain widgets/clock/dist | head` and inspect: `ls widgets/clock/dist`
Expected: `remoteEntry.js` present (dist is gitignored via Task 6; here we only eyeball it).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(widgets): package clock as a federation remote with a dev harness"
```

---

## Task 5: Convert `ofelia-poop-duty` into a remote and remove the umbrella package

**Files:**
- Create: `widgets/ofelia-poop-duty/{package.json,vite.config.ts,vitest.config.ts,tsconfig.json,index.html}`, `widgets/ofelia-poop-duty/ui/expose.ts`, `widgets/ofelia-poop-duty/dev/{main.tsx,harness.tsx}`
- Modify: `widgets/ofelia-poop-duty/client.ts`, `widgets/ofelia-poop-duty/server.ts` (add `export default`)
- Delete: `widgets/package.json` (umbrella)
- Modify: `pnpm-workspace.yaml` (drop the `widgets` entry), `client/vite.config.ts` + `client/tsconfig.json` are handled in Task 7

**Interfaces:**
- Produces: workspace package `widgets-ofelia-poop-duty`; remote `widgets/ofelia-poop-duty/dist/remoteEntry.js` exposing `./ui`; default exports on its `client.ts`/`server.ts`.

- [ ] **Step 1: Write `widgets/ofelia-poop-duty/package.json`**

Identical to clock's except `"name": "widgets-ofelia-poop-duty"`. Ofelia's models import `@reatom/react` transitively through `widget-sdk`, and its UI uses `getServerTime` from `widget-runtime` — both already covered by the same deps as clock, so the dependency list is byte-identical to Task 4 Step 2 apart from the name:

```json
{
  "name": "widgets-ofelia-poop-duty",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@reatom/core": "catalog:",
    "lucide-react": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "widget-runtime": "workspace:*",
    "widget-sdk": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@module-federation/vite": "^1.16.12",
    "@testing-library/react": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "^6.0.2",
    "vite": "^8.0.16",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: Write `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`**

`vite.config.ts` and `vitest.config.ts` are byte-identical to clock's (Task 4 Step 3) — they read the directory name at runtime:
```ts
import { defineWidgetViteConfig } from 'widget-sdk/vite'
export default defineWidgetViteConfig(import.meta.dirname)
```
```ts
import { defineWidgetVitestConfig } from 'widget-sdk/vite'
export default defineWidgetVitestConfig(import.meta.dirname)
```
`tsconfig.json` is identical to clock's (Task 4 Step 4).

- [ ] **Step 3: Default exports**

`widgets/ofelia-poop-duty/client.ts` — append `export default ofeliaWidget`.
`widgets/ofelia-poop-duty/server.ts` — append `export default ofeliaServer`.

- [ ] **Step 4: Exposed UI + harness**

`widgets/ofelia-poop-duty/ui/expose.ts`:
```ts
export { OfeliaPoopDuty as default } from './OfeliaPoopDuty'
```

`widgets/ofelia-poop-duty/dev/harness.tsx` (same shape as clock's; `DEV_ID = 'ofelia-poop-duty'`):
```tsx
import { makeWidgetApi, makeWidgetStorage } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk'

import Widget from '../ui/expose'

const DEV_ID = 'ofelia-poop-duty'

export function harnessProps(): WidgetRuntimeProps {
  return {
    instanceId: `dev:${DEV_ID}`,
    typeId: DEV_ID,
    mode: 'large',
    tier: 'standard',
    theme: 'light',
    requestFullscreen: () => {},
    requestClose: () => {},
    requestDelete: () => {},
    reportError: (error) => console.warn('[harness]', error),
    storage: makeWidgetStorage({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
    api: makeWidgetApi({ instanceId: `dev:${DEV_ID}`, typeId: DEV_ID }),
  }
}

export const HarnessApp = reatomMemo(() => <Widget {...harnessProps()} />, 'OfeliaHarness')
```

`widgets/ofelia-poop-duty/dev/main.tsx` (identical to clock's, importing `./harness`), and `index.html` (identical to clock's except `<title>ofelia-poop-duty — standalone</title>`).

(No harness smoke test for ofelia — the clock harness test already covers the harness wiring; ofelia's rich models are covered by its existing unit tests.)

- [ ] **Step 5: Remove the umbrella package**

```bash
git rm widgets/package.json
```
In `pnpm-workspace.yaml`, delete the `- widgets` line (keep `- widgets/*`).

- [ ] **Step 6: Install and verify both remotes**

Run:
```bash
pnpm install
pnpm --filter widgets-ofelia-poop-duty test
pnpm --filter widgets-ofelia-poop-duty build
pnpm --filter widgets-clock build
```
Expected: install drops the `widgets` importer and links both `widgets-*` packages; ofelia's suite green; both remotes build a `dist/remoteEntry.js`.

Because the umbrella `widgets/package.json` is gone, the board no longer has a `widgets` workspace importer — but the board still imports widget `client.ts`/`server.ts` through the `@widgets/*` **path alias**, which resolves file paths independent of packages, so `pnpm typecheck`/`pnpm test`/`pnpm build` still pass. Confirm:
Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(widgets): package ofelia as a remote; drop the umbrella widgets package"
```

---

## Task 6: The `codegen` script (catalog, icons, server list, ports)

**Files:**
- Create: `scripts/codegen.ts`, `scripts/codegen.test.ts`
- Modify: root `package.json` (add `"codegen"` script + `jiti`/`tsx` devDeps)
- Create: `widgets/.ports.json` (committed) — generated on first run
- Modify: `.gitignore`

**Interfaces:**
- Produces: `pnpm codegen` writing `client/src/widget-registry/model/widget-catalog.generated.ts`, `client/src/widget-registry/model/widget-icons.generated.ts`, `server/src/widgets/widget-server-list.generated.ts`, and (idempotently) `widgets/.ports.json`. Pure emitters exported for tests: `emitCatalog`, `emitIcons`, `emitServerList`, `assignPorts`, `discoverWidgetDirs`.
- Consumes: each widget's default-exported client definition (Tasks 4–5), read via `jiti`.

- [ ] **Step 1: Add tooling deps + the runtime loader + script**

Run:
```bash
pnpm add -w -D jiti@^2.6.1 tsx@^4.20.6
pnpm --filter client add @module-federation/runtime
```
Add `@module-federation/runtime` here (not in Task 7) so the generated catalog — which lands on disk in Step 7 and is typechecked by the client from then on — resolves its `loadRemote` import immediately. If pnpm emits a peer warning, align the version to what `@module-federation/vite@1.16.12` resolves: `pnpm why @module-federation/runtime` and pin that.

In root `package.json` `scripts`, add:
```json
    "codegen": "tsx scripts/codegen.ts",
```

- [ ] **Step 2: Write the failing emitter/port tests** — `scripts/codegen.test.ts`

```ts
import { describe, expect, it } from 'vitest'

import { assignPorts, emitCatalog, emitIcons, emitServerList, type WidgetMeta } from './codegen'

const metas: WidgetMeta[] = [
  {
    dir: 'clock',
    id: 'clock',
    title: 'Часы',
    description: 'Текущее время и дата',
    defaultSize: { w: 3, h: 4, minW: 2, minH: 2 },
    icon: 'Clock',
  },
  {
    dir: 'ofelia-poop-duty',
    id: 'ofelia-poop-duty',
    title: 'Лоток Офелии',
    description: 'Чья сегодня очередь убирать',
    defaultSize: { w: 3, h: 5, minW: 2, minH: 3 },
    icon: 'Cat',
    tiers: { tiny: { minWidthPx: 0, minHeightPx: 0 } },
  },
]

describe('codegen emitters', () => {
  it('inlines catalog metadata and a loadRemote loader per widget', () => {
    const out = emitCatalog(metas)
    expect(out).toContain("import { loadRemote } from '@module-federation/runtime'")
    expect(out).toContain('"id": "clock"')
    expect(out).toContain('Лоток Офелии')
    expect(out).toContain("loadRemoteModule('ofelia-poop-duty')")
    expect(out).not.toContain('./ui/Clock') // no eager UI import in the board bundle
  })

  it('derives a closed icon union + map from the icons actually used', () => {
    const out = emitIcons(metas)
    expect(out).toContain("import { Cat, Clock } from 'lucide-react'")
    expect(out).toContain("export type WidgetIconName = 'Cat' | 'Clock'")
    expect(out).toContain('export const WIDGET_ICONS: Record<WidgetIconName, LucideIcon> = { Cat, Clock }')
  })

  it('imports each widget server default export into the server list', () => {
    const out = emitServerList(metas)
    expect(out).toContain("import clock from '@widgets/clock/server'")
    expect(out).toContain('toRuntimeWidgetServerDefinition(clock)')
    expect(out).toContain('toRuntimeWidgetServerDefinition(ofeliaPoopDuty)')
  })

  it('keeps existing ports and appends max+1 for new widgets', () => {
    expect(assignPorts(['clock', 'ofelia-poop-duty'], {})).toEqual({
      clock: 5180,
      'ofelia-poop-duty': 5181,
    })
    expect(assignPorts(['aa', 'clock'], { clock: 5180 })).toEqual({ clock: 5180, aa: 5181 })
  })
})
```

- [ ] **Step 3: Run it (fails)**

Run: `pnpm exec vitest run scripts/codegen.test.ts`
Expected: FAIL — `./codegen` missing. (Root vitest picks it up; if no root vitest config exists, run `pnpm --filter client exec vitest run ../../scripts/codegen.test.ts` — but prefer adding `scripts` under an existing runner. Simplest: this test lives beside the script and is run via `pnpm exec vitest run scripts/codegen.test.ts` from root, which uses Vitest's default config.)

- [ ] **Step 4: Implement** — `scripts/codegen.ts`

```ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createJiti } from 'jiti'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const widgetsDir = resolve(root, 'widgets')
const portsFile = resolve(widgetsDir, '.ports.json')
const BANNER = '// AUTO-GENERATED by scripts/codegen.ts. Do not edit.\n\n'

export type WidgetMeta = {
  dir: string
  id: string
  title: string
  description: string
  defaultSize: { w: number; h: number; minW?: number; minH?: number }
  tiers?: unknown
  icon: string
}

/** camelCase a widget dir so it is a valid JS identifier for generated imports. */
function ident(dir: string): string {
  return dir.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

export function discoverWidgetDirs(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name !== 'node_modules' && !name.startsWith('.'))
    .filter((name) => existsSync(resolve(dir, name, 'package.json')))
    .sort()
}

export function assignPorts(dirs: string[], existing: Record<string, number>): Record<string, number> {
  const ports = { ...existing }
  let next = Math.max(5179, ...Object.values(ports)) + 1
  for (const dir of dirs) if (ports[dir] == null) ports[dir] = next++
  return ports
}

export function emitCatalog(metas: WidgetMeta[]): string {
  const entries = metas
    .map((m) => {
      const meta = { id: m.id, title: m.title, description: m.description, defaultSize: m.defaultSize, ...(m.tiers ? { tiers: m.tiers } : {}), icon: m.icon }
      const literal = JSON.stringify(meta, null, 2).replace(/\n/g, '\n    ')
      return `  toWidgetType({\n    ...(${literal} as WidgetMetadata),\n    loadComponent: () => loadRemoteModule('${m.id}'),\n  })`
    })
    .join(',\n')
  return `${BANNER}import { loadRemote } from '@module-federation/runtime'
import { toWidgetType, type WidgetMetadata, type WidgetType } from 'widget-sdk/define-widget-client'
import type { WidgetComponentModule } from 'widget-runtime'

function loadRemoteModule(id: string): Promise<WidgetComponentModule> {
  return loadRemote<WidgetComponentModule>(\`\${id}/ui\`).then((mod) => {
    if (!mod) throw new Error(\`Widget remote failed to load: \${id}\`)
    return mod
  })
}

export const widgetTypes: WidgetType[] = [
${entries},
]
`
}

export function emitIcons(metas: WidgetMeta[]): string {
  const icons = [...new Set(metas.map((m) => m.icon))].sort()
  const union = icons.map((i) => `'${i}'`).join(' | ')
  return `${BANNER}import { ${icons.join(', ')} } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type WidgetIconName = ${union}

export const WIDGET_ICONS: Record<WidgetIconName, LucideIcon> = { ${icons.join(', ')} }
`
}

export function emitServerList(metas: WidgetMeta[]): string {
  const imports = metas.map((m) => `import ${ident(m.dir)} from '@widgets/${m.dir}/server'`).join('\n')
  const list = metas.map((m) => `  toRuntimeWidgetServerDefinition(${ident(m.dir)})`).join(',\n')
  return `${BANNER}import { toRuntimeWidgetServerDefinition, type RuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
${imports}

export const widgetServerList: RuntimeWidgetServerDefinition[] = [
${list},
]
`
}

async function readMeta(dir: string): Promise<WidgetMeta> {
  const jiti = createJiti(fileURLToPath(import.meta.url), {
    alias: { '@shared': resolve(root, 'shared') },
    moduleCache: false,
  })
  const mod = await jiti.import<{ default: Omit<WidgetMeta, 'dir'> }>(resolve(widgetsDir, dir, 'client.ts'))
  const d = mod.default
  return { dir, id: d.id, title: d.title, description: d.description, defaultSize: d.defaultSize, tiers: d.tiers, icon: d.icon }
}

async function main() {
  const dirs = discoverWidgetDirs(widgetsDir)
  const metas = await Promise.all(dirs.map(readMeta))
  const existing = existsSync(portsFile) ? (JSON.parse(readFileSync(portsFile, 'utf8')) as Record<string, number>) : {}
  const ports = assignPorts(dirs, existing)

  writeFileSync(resolve(root, 'client/src/widget-registry/model/widget-catalog.generated.ts'), emitCatalog(metas))
  writeFileSync(resolve(root, 'client/src/widget-registry/model/widget-icons.generated.ts'), emitIcons(metas))
  writeFileSync(resolve(root, 'server/src/widgets/widget-server-list.generated.ts'), emitServerList(metas))
  writeFileSync(portsFile, `${JSON.stringify(ports, null, 2)}\n`)
  console.log(`codegen: ${dirs.length} widget(s) — ${dirs.join(', ')}`)
}

// Run only when executed directly (not when imported by the test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main()
}
```

- [ ] **Step 5: Run the emitter tests (pass)**

Run: `pnpm exec vitest run scripts/codegen.test.ts`
Expected: all 4 PASS.

- [ ] **Step 6: Gitignore the generated files** — append to `.gitignore`:

```gitignore
# codegen output (scripts/codegen.ts); widgets/.ports.json is committed on purpose
client/src/widget-registry/model/widget-catalog.generated.ts
client/src/widget-registry/model/widget-icons.generated.ts
server/src/widgets/widget-server-list.generated.ts
widgets/*/dist/
```

- [ ] **Step 7: Generate once and sanity-check**

Run: `pnpm codegen`
Expected: prints `codegen: 2 widget(s) — clock, ofelia-poop-duty`; creates `widgets/.ports.json` = `{ "clock": 5180, "ofelia-poop-duty": 5181 }`; the three `*.generated.ts` files exist (and are gitignored). Open the catalog and confirm it inlines both titles and uses `loadRemoteModule('clock')` (no `./ui/Clock` import).

Run: `git status --porcelain` → only `widgets/.ports.json` and modified `.gitignore`/`package.json`/`pnpm-lock.yaml` appear (the `*.generated.ts` are ignored).

- [ ] **Step 8: Typecheck the generated files (they are now on disk, still unconsumed)**

Run: `pnpm -r typecheck`
Expected: green. The generated catalog/icons/server-list are dead (nothing imports them yet) but live under `client/src`/`server/src`, so tsc validates them: the catalog resolves `@module-federation/runtime` (installed Step 1), `widget-sdk/define-widget-client`, and `widget-runtime`; the server list resolves `@widgets/*/server` defaults (Tasks 4–5). This proves the emitters produce valid TypeScript before Task 7 wires them in.

- [ ] **Step 9: Commit**

```bash
git add scripts .gitignore package.json pnpm-lock.yaml widgets/.ports.json
git commit -m "feat(widgets): add codegen for catalog, icons, server list, and ports"
```

---

## Task 7: Wire host federation + generated catalog/registry + scripts

**Files:**
- Modify: `client/vite.config.ts` (functional config + federation host; drop `@widgets` alias + `../widgets/**` test glob)
- Modify: `client/src/widget-registry/model/registry.ts` (consume generated catalog + icons)
- Modify: `client/src/board/ui/AddWidgetMenu.tsx` (use generated `WIDGET_ICONS`)
- Modify: `widget-sdk/src/define-widget-client.ts` (loosen `icon` to `string`; drop `WidgetIconName`)
- Modify: `client/tsconfig.json` (drop `../widgets` from `include`, `@widgets` from `paths`)
- Modify: `server/src/widgets/production-registry.ts` (consume generated list)
- Modify: root `package.json` (`dev`, `dev:server`, `build`, `typecheck`, `test` run codegen; `dev` runs widgets in parallel)
- Add: `client` devDep `@module-federation/vite` (the host config imports `federation` directly)

**Interfaces:**
- Consumes: everything from Tasks 3–6 (`@module-federation/runtime` was already added to `client` in Task 6 Step 1).
- Produces: a board that resolves widgets as federation remotes (dev → widget dev servers; build → `/widgets/<id>/`), a synchronous codegen'd catalog, and a codegen `pre`-step on every consuming script.

- [ ] **Step 1: Add the federation host plugin dep**

Run: `pnpm --filter client add -D @module-federation/vite@^1.16.12`
(`@module-federation/runtime` and `@vitejs/plugin-react` are already `client` deps. Verify at Step 9 that `loadRemote` works end to end; if pnpm dedupes the runtime to a different version than the plugin bundles, align to `pnpm why @module-federation/runtime`.)

- [ ] **Step 2: Convert `client/vite.config.ts` to a functional config with the federation host**

Replace the top imports and the `plugins`/`resolve`/`preview` sections. Full head of the file:

```ts
import { resolve } from 'node:path'

import { federation } from '@module-federation/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults, defineConfig } from 'vitest/config'
import { apiProxy, federationShared, previewWidgetsProxy, widgetRemotes } from 'widget-sdk/vite'

const portsFile = resolve(__dirname, '../widgets/.ports.json')

export default defineConfig(({ command }) => ({
  plugins: [
    // Federation is a build/serve concern; keep it out of the vitest run.
    ...(process.env.VITEST
      ? []
      : [
          federation({
            name: 'board',
            filename: 'remoteEntry.js',
            remotes: widgetRemotes({ command, portsFile }),
            shared: federationShared(),
            dev: { remoteHmr: true },
            manifest: false,
          }),
        ]),
    react(),
    tailwindcss(),
    VitePWA({
      /* ...unchanged VitePWA(...) config... */
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
  build: {
    /* ...unchanged rolldownOptions... (codeSplitting.groups reconciliation is Plan 3) */
  },
  test: {
    globals: true,
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    environment: 'jsdom',
    setupFiles: ['./src/vitest.setup.ts'],
    testTimeout: 30000,
    exclude: [...configDefaults.exclude, 'e2e/**'],
    execArgv: ['--harmony-temporal'],
  },
  server: {
    watch:
      process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 100 } : undefined,
    proxy: apiProxy(),
  },
  preview: {
    proxy: { ...apiProxy(), ...previewWidgetsProxy(portsFile) },
  },
}))
```

Changes vs. today: functional form for `command`; federation host plugin (guarded out of vitest); `@widgets`/`@widget-runtime`/`@widget-sdk` aliases removed (bare packages resolve via `exports`; `@widget-runtime`/`@widget-sdk` were already removed in Tasks 1–2); the `../widgets/**` test `include` glob and the widgets `exclude` entries removed (widget tests run from their own packages now); the preview proxy adds `previewWidgetsProxy` for e2e (Task 8). Keep the existing `VitePWA(...)` and `build.rolldownOptions` blocks verbatim.

- [ ] **Step 3: Rewrite the client registry to consume generated output** — `client/src/widget-registry/model/registry.ts`

```ts
import * as errore from 'errore'

import { widgetTypes } from './widget-catalog.generated'
import { WIDGET_ICONS, type WidgetIconName } from './widget-icons.generated'
import type { WidgetType } from 'widget-sdk/define-widget-client'

export { widgetTypes, WIDGET_ICONS }
export type { WidgetIconName, WidgetType }

export class UnknownWidgetTypeError extends errore.createTaggedError({
  name: 'UnknownWidgetTypeError',
  message: 'Unknown widget type: $typeId',
}) {}

type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number }
type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (cb: (d: IdleDeadline) => void, o?: { timeout: number }) => number
}

export function preloadWidgetChunks() {
  if (typeof window === 'undefined') return
  const preload = () => {
    for (const type of widgetTypes) type.preloadComponent?.()
  }
  const idleWindow = window as WindowWithIdleCallback
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(preload, { timeout: 3000 })
    return
  }
  window.setTimeout(preload, 1500)
}

export function findWidgetType(typeId: string): UnknownWidgetTypeError | WidgetType {
  const type = widgetTypes.find((item) => item.id === typeId)
  if (!type) return new UnknownWidgetTypeError({ typeId })
  return type
}
```

- [ ] **Step 4: Point `AddWidgetMenu` at the generated icon map** — `client/src/board/ui/AddWidgetMenu.tsx`

Replace the widget-icon import + local map. Change line 2's lucide import to drop the widget icons (keep only chrome icons), and replace the `WIDGET_ICONS` const + `WidgetIconName` import with the generated ones:

```ts
import { Lock, Plus, X } from 'lucide-react'
// ...
import { WIDGET_ICONS, type WidgetIconName } from '@/widget-registry/model/registry'
```

Delete the local `const WIDGET_ICONS: Record<WidgetIconName, LucideIcon> = { Clock, CalendarDays, Cat }` block and the now-unused `LucideIcon` import. `type.icon` is now `string` (Step 5); index the map defensively:

```ts
const Icon = WIDGET_ICONS[type.icon as WidgetIconName] ?? Plus
```

- [ ] **Step 5: Loosen the SDK icon type** — `widget-sdk/src/define-widget-client.ts`

Remove `export type WidgetIconName = 'Clock' | 'CalendarDays' | 'Cat'` and change `WidgetMetadata.icon` from `WidgetIconName` to `string`:

```ts
export type WidgetMetadata = {
  id: string
  title: string
  description: string
  defaultSize: { w: number; h: number; minW?: number; minH?: number }
  tiers?: TierConfig
  icon: string
}
```

The closed `WidgetIconName` union now lives only in the generated icons file (derived from real usage); the board re-exports it from `registry.ts` (Step 3), so all existing `WidgetIconName` consumers keep resolving.

- [ ] **Step 6: Update client tsconfig**

In `client/tsconfig.json`: remove `"@widgets/*"` from `paths`; change `"include"` from `["src", "../widgets", "tests"]` to `["src", "tests"]`.

- [ ] **Step 7: Wire the server registry to the generated list** — `server/src/widgets/production-registry.ts`

```ts
import { createWidgetServerRegistry } from './registry'
import { widgetServerList } from './widget-server-list.generated'

const registry = createWidgetServerRegistry(widgetServerList)
if (registry instanceof Error) throw registry

export const productionWidgetServerRegistry = registry
```

- [ ] **Step 8: Wire codegen into every consuming script** — root `package.json`:

```json
    "dev": "pnpm run codegen && pnpm -r --parallel --filter \"./widgets/*\" --filter client dev",
    "dev:server": "pnpm run codegen && pnpm --filter server dev",
    "build": "pnpm run codegen && pnpm --filter client build",
    "test": "pnpm run codegen && pnpm -r test",
    "typecheck": "pnpm run codegen && pnpm -r typecheck",
    "codegen": "tsx scripts/codegen.ts",
```

(Explicit `pnpm run codegen && …` at the root runs codegen once before the recursive step — robust regardless of pnpm's `enable-pre-post-scripts` default. `pnpm build` stays client-only in Plan 2; the widgets-then-client orchestration is Plan 3.)

- [ ] **Step 9: Verify dev-mode federation + the runtime singleton**

Run codegen and boot the stack (needs the storage server; use a second terminal or `pnpm docker:server`):
```bash
pnpm run codegen
pnpm dev
```
In a browser at the board URL: the "Добавить виджет" catalog lists both widgets **immediately** (synchronous). Add each widget — it mounts (its remote loads via `loadRemote`). Edit `widgets/clock/ui/Clock.tsx` (change a style) — the board view updates via HMR **without** a full reload. In the console run `import('@module-federation/runtime').then(m => m.getInstance?.())` is not required; instead confirm **one** `widget-runtime` instance by evaluating that the board's server-time and a mounted widget's `getServerTime()` share state (add a temporary `console.log((window as any).__mfShared)` only if debugging). The acceptance signal is: no "Invalid hook call" / duplicate-dispatcher errors, and clock/ofelia render live.

- [ ] **Step 10: Verify build + unit + typecheck**

Run: `pnpm run codegen && pnpm --filter client build && pnpm test && pnpm typecheck`
Expected: client build succeeds (federation host emits runtime `loadRemote` calls; remotes are runtime-resolved, so the build does not need them present); all unit suites (client, server, widget-runtime, widget-sdk, both widgets) pass; typecheck green. `registry.test.ts`'s `['Clock','Cat']` assertion still holds (catalog order = sorted dirs → clock, ofelia).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(widgets): consume widgets as federation remotes via codegen'd registries"
```

---

## Task 8: Keep board e2e green against a production-style build (preview proxy)

**Files:**
- Modify: `client/playwright.config.ts` (build+preview each widget; build+preview the board)
- Verify only (the `previewWidgetsProxy` wiring landed in Task 7 Step 2)

**Interfaces:**
- Consumes: per-widget `build`/`preview` scripts (Tasks 4–5), `previewWidgetsProxy` (Task 3), host build-mode remotes = `/widgets/<id>/remoteEntry.js` (Task 3/7).

Rationale: the board's built host references `/widgets/<id>/remoteEntry.js` **same-origin**. Each widget's `vite preview` serves its `dist` under `base: '/widgets/<id>/'` on its `.ports.json` port; the board preview proxies `/widgets/<id>/**` to that port (`previewWidgetsProxy`). This proves federation in a real production build using only Vite — nginx/dist-copy/PWA are Plan 3.

- [ ] **Step 1: Extend the Playwright web servers** — `client/playwright.config.ts`

Replace the `webServer` array with (storage server unchanged; add one build+preview per widget before the board):

```ts
  webServer: [
    {
      command: 'pnpm --filter server build && node ../server/dist/test-server.cjs',
      url: 'http://localhost:8787/api/time',
      env: { PORT: '8787' },
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter widgets-clock build && pnpm --filter widgets-clock preview',
      url: 'http://localhost:5180/widgets/clock/remoteEntry.js',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command:
        'pnpm --filter widgets-ofelia-poop-duty build && pnpm --filter widgets-ofelia-poop-duty preview',
      url: 'http://localhost:5181/widgets/ofelia-poop-duty/remoteEntry.js',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm run codegen && npm run build && npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
    },
  ],
```

(The board `command` runs from `client/`, so `pnpm run codegen` resolves to the root script via pnpm workspace root; if that path is awkward in your shell, use `pnpm -w run codegen` instead. The widget `preview` `url` checks assert the remote entry is actually served on the widget's port before the board starts.)

- [ ] **Step 2: Run e2e**

Run: `pnpm test:e2e`
Expected: Playwright builds both widget remotes + the board, serves them, and both existing specs (`widget-interactions.spec.ts`, `ofelia-duty.spec.ts`) pass — the board loads `clock`/`ofelia-poop-duty` remotes same-origin through the preview proxy.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(widgets): run board e2e against federated remotes via preview proxy"
```

---

## Task 9: Full verification, boundary checks, cleanup

**Files:**
- Verify only; delete any now-empty leftover dirs

**Interfaces:**
- Consumes: everything from Tasks 1–8.

- [ ] **Step 1: No stale aliases remain**

Run: `git grep -n "@widget-runtime/\|@widget-sdk/" -- client/src widgets widget-sdk`
Expected: only `widget-runtime/storage/test/fakes`, `widget-runtime/timer/fakes`, and `widget-sdk/define-widget-client` (the intentionally-kept subpaths).

Run: `git grep -n "@widgets/" -- client`
Expected: empty (the board no longer imports widget source; only the **server** uses `@widgets/*`).

- [ ] **Step 2: One-way package dependency (no cycle)**

Run: `git grep -n "widget-sdk" -- widget-runtime/src`
Expected: empty — `widget-runtime` never imports `widget-sdk`.

- [ ] **Step 3: Fresh-checkout codegen gate (Success criterion: typecheck/test pass with no prior dev/build)**

```bash
rm client/src/widget-registry/model/widget-catalog.generated.ts
rm client/src/widget-registry/model/widget-icons.generated.ts
rm server/src/widgets/widget-server-list.generated.ts
pnpm typecheck
pnpm test
```
Expected: both pass — each runs `pnpm run codegen` first (Task 7 Step 8), regenerating the deleted files. This simulates a clean checkout/CI.

- [ ] **Step 4: Add-a-widget dry check (ports stability)**

Confirm `widgets/.ports.json` is unchanged by a re-run: `pnpm codegen && git diff --exit-code widgets/.ports.json`
Expected: exit 0 (existing ports untouched). Adding a hypothetical widget that sorts before `clock` would still leave `clock`/`ofelia-poop-duty` on 5180/5181 and assign the newcomer `max+1` — verified by `assignPorts` unit tests (Task 6).

- [ ] **Step 5: Remove empty leftover dirs**

Run: `find client/src widgets -type d -empty`
Delete only genuinely-empty dirs left by the moves. Do not touch `widgets/*/dist` (gitignored build output).

- [ ] **Step 6: Full matrix**

```bash
pnpm install
pnpm run codegen
pnpm typecheck
pnpm -r test
pnpm --filter client build
pnpm --filter widgets-clock build
pnpm test:e2e
```
Expected: all green — install clean; typecheck no errors; every package suite passes; the client (host) and one widget both build; e2e passes against federated remotes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(widgets): boundary checks and cleanup after federation rollout"
```

---

## Error Handling

- A failed remote load (widget dev server down, missing built asset, network error) surfaces through the **existing** `WidgetErrorBoundary` + `widget-frame-model.ts` retry path: `WidgetFrame` wraps `lazy(type.loadComponent)` in the error boundary, and the generated `loadRemoteModule` throws (never returns `null`) so a failure rejects the lazy import and renders the "Виджет не отвечает" card with retry. The catalog itself no longer depends on remote loads, so one failing remote degrades only its own widget.
- A shared-singleton **version mismatch** is, by default, only a Module Federation runtime warning. `federationShared()` sets `singleton: true` **and** `strictVersion: true` for `react`, `react-dom`, `@reatom/core`, `@reatom/react`, and `widget-runtime`, turning a mismatch into a build/dev failure. Because every consumer resolves the same versions through the pnpm `catalog` (and `widget-runtime` is a single `workspace:*` `0.0.0`), a mismatch can only come from a misconfigured `package.json` — caught by CI builds.

## Deviations from the design (documented, intentional)

1. **`widget-runtime` is a bare-package barrel; `widget-sdk` is a bare-package with subpaths — neither uses the `@widget-runtime/*`/`@widget-sdk/*` aliases anymore.** The spec assumed `widget-runtime` could be a federation singleton while Plan 1 shipped subpath aliases; MF shares by bare module request, so honoring the singleton requirement (your chosen option) required collapsing `widget-runtime` into a single `exports`-mapped bare barrel. `widget-sdk` is **not** collapsed to one barrel and is **not** in the shared scope: it keeps granular subpaths (`widget-sdk/lib/utils`, `widget-sdk/ui/*`, `widget-sdk/reatom/*`) because those are shadcn's resolution targets, and it is stateless so per-remote duplication is harmless (the design already marked it non-singleton). Test-only (`widget-runtime/timer/fakes`, `.../storage/test/fakes`) and config-only (`widget-sdk/vite`) entrypoints stay explicit subpaths.
5. **shadcn keeps working in `widget-sdk`.** `widget-sdk` becomes a shadcn "shared UI package" (`components.json` with `#components`/`#lib/utils` aliases backed by `package.json#imports`); `client/components.json`'s `utils` alias is repointed to `widget-sdk/lib/utils` (fixing a break Plan 1 introduced when it moved `cn` out of the client). Because federated widget UIs leave the board's module graph, the board CSS `@source`s `widget-sdk/src` + `widgets/*/ui` so Tailwind still emits their shadcn utility classes.
2. **`WidgetMetadata.icon` is `string` (widget-sdk), with the closed `WidgetIconName` union generated on the board side.** This avoids a `widget-sdk → generated-icons` back-dependency while still giving the board an exhaustive, codegen-derived icon map. Widget authors may use any lucide icon name; an invalid name fails the generated icon import at build.
3. **The federation "manifest" is `widgets/.ports.json`.** Its keys are the widget id list and its values the dev ports, so the host derives both dev remotes and prod paths from it — no separate manifest file is generated.
4. **The runtime-singleton "spike" is a real verification gate, not a throwaway** (Task 7 Step 9 in dev + Task 8 e2e against a production build), validating MF sharing of a workspace **source** package in the actual system.

## Self-Review

**Spec coverage (Plan 2 = Phased Rollout steps 3–4):**
- "Convert `widgets/*` into individual pnpm packages (`widgets-<dir>`)" → Tasks 4–5.
- "federation `exposes` for the UI component only, `base: '/widgets/<id>/'`, `dev.remoteHmr`, shared singletons incl. `strictVersion`" → Task 3 (factory) + Tasks 4–5 (per widget); singletons + strictVersion in `federationShared()`; `widget-runtime` made a true singleton via Tasks 1–2 (your chosen option).
- "standalone `dev/` harness built from the shared dev Vite config" → Tasks 4–5 (`dev/main.tsx` + harness), server via `apiProxy()`; smoke test Task 4 Step 8.
- "Wire the host to consume them as remotes, `remoteHmr` on every config" → Task 7 (host) + Task 3 factory (remotes); `remoteHmr: true` in both `defineWidgetViteConfig` and the host.
- "single `codegen` (client registry inlined static metadata, `WidgetIconName` union, server registry, federation manifest)" → Task 6; catalog/icons/server-list + `.ports.json` as manifest.
- "wire codegen as `pre*` of dev/build/dev:server/typecheck/test" → Task 7 Step 8 (explicit `codegen &&`).
- "remove hand-written registries + icon union" → Task 7 Steps 3–5, 7.
- "synchronous codegen'd catalog with `loadRemote()` loaders" → `emitCatalog` (Task 6) + Task 7 Step 9 verification.
- "`widgets/.ports.json`; per-widget `vitest.config.ts`; remove `../widgets/**` glob" → Tasks 4–6 + Task 7 Step 2.
- Success criteria: independent widget build (Task 4 Step 9 / Task 9 Step 6); one react/reatom per page (Task 7 Step 9); HMR (Task 7 Step 9); standalone harness renders (Task 4 Step 8); add-a-widget with no hand-edit (Task 6 + `pnpm dev`/`build` scripts never name widgets); ports stable (Task 9 Step 4); `pnpm dev`/`dev:server` single commands (Task 7 Step 8); synchronous catalog (Task 6/7); fresh-checkout typecheck/test (Task 9 Step 3).

**User constraint — shadcn keeps working in widget-sdk:** Task 2 keeps `widget-sdk`'s subpaths stable (`widget-sdk/lib/utils`, `widget-sdk/ui/*`) via the `exports` map, adds a `widget-sdk/components.json` + `package.json#imports` so `shadcn add` targets the shared package, fixes `client/components.json`'s stale `utils` alias, and `@source`s widget source into the board's Tailwind so federated shadcn components stay styled (Task 2 Steps 5–8). `widget-sdk` is dropped from the federation shared scope accordingly (Task 3).

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". The only "copy verbatim from an existing file" instruction is Task 2 Step 4 (polyfill blocks from `client/src/vitest.setup.ts`) and the "unchanged VitePWA/rolldownOptions" blocks in Task 7 Step 2, both pointing at exact existing files.

**Type/specifier consistency:** `federationShared`/`widgetRemotes`/`defineWidgetViteConfig`/`defineWidgetVitestConfig` produced in Task 3, consumed in Tasks 4/5/7. `emitCatalog`/`emitIcons`/`emitServerList`/`assignPorts`/`WidgetMeta` produced in Task 6, tested there. `widgetTypes` (generated) consumed by `registry.ts` (Task 7); `WIDGET_ICONS`/`WidgetIconName` (generated) consumed by `registry.ts` re-export + `AddWidgetMenu` (Task 7). `widget-server-list.generated`'s `widgetServerList` consumed by `production-registry.ts` (Task 7). `loadRemoteModule` returns `WidgetComponentModule` matching `WidgetLoader`/`lazy`. Remote name = id = dir throughout (`clock`, `ofelia-poop-duty`).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-01-widget-federation-and-codegen.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
