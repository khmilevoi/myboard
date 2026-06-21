# myboard Design Update (Shell + Design System) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the myboard host shell to the supplied violet/flat mockup by collapsing three competing token systems into one `data-theme`-keyed semantic layer, fixing dark mode, swapping fonts, adding the agreed shadcn primitives, and restyling every chrome surface with Russian copy.

**Architecture:** One semantic token layer in `tokens.css` (keyed to `:root[data-theme='light'|'dark']`) feeds both shadcn primitives (Tailwind utilities) and bespoke layout (CSS Modules). `global.css` keeps Tailwind/`@theme inline` wiring, swaps the dark variant to track `data-theme`, and swaps fonts. Standard UI uses shadcn primitives; board/card/catalog/overlay layout stays in CSS Modules reading the shared tokens. Widget internals and the `WidgetMode` contract are untouched.

**Tech Stack:** React 19, Reatom v1000 (`@reatom/core`/`@reatom/react`), Tailwind v4 (`@tailwindcss/vite`), shadcn (radix-nova) over the unified `radix-ui` package, lucide-react, react-grid-layout v2, Vitest + Testing Library, Playwright, `@fontsource-variable/*`. Source design: `docs/superpowers/specs/2026-06-18-myboard-design-update-design.md`.

## Global Constraints

These apply to **every** task. Each task's requirements implicitly include this section.

- **reatomMemo rule (hard):** every exported React component in `client/src` and `client/widgets` is defined with `reatomMemo` from `@/shared/reatom/reatom-memo` (`reatomMemo(fn, 'Name')`). Direct re-exports of `radix-ui` primitives (e.g. `const Popover = PopoverPrimitive.Root`) are library components, not defined components, so they are exempt — only components we render ourselves get wrapped. Error boundaries keep the class internal and export a `reatomMemo` wrapper.
- **ui/model split:** components, CSS Modules, view tests live in `ui/`; atoms/actions/computeds/domain logic and model tests live in `model/`. Keep derived state, filters, async, and cross-component UI state in `model/` atoms — only refs, DOM interop, and tiny view glue in `ui/`.
- **errore:** errors are values (`X | Error` unions, `instanceof Error` checks, early returns). Do not introduce `throw`/`try-catch` for control flow.
- **Code style:** TypeScript + ESM, 2-space indent, single quotes, **no semicolons**, named exports, CSS Modules named `*.module.css`, PascalCase component filenames.
- **Reatom in components:** read atoms by calling them (`themeMode()`), wrap event handlers/imperative calls with `wrap(...)` exactly as the existing components do.
- **Modern HTML:** use native semantics where they fit. In this plan, the catalog filter is wrapped in `<search>` rather than a generic `<div>`/`role="search"`, and Dialog/Popover behavior is delegated to Radix/shadcn primitives.
- **Token rule:** the brand violet is `--primary`. shadcn's `--accent` is a muted hover background mapped to `--secondary`/`--muted` — never use `--accent` for the brand. The selected/recommended tint is the app token `--accent-soft`.
- **Path alias:** `@/` → `client/src`. Use `@/components/ui/...`, `@/lib/utils`, `@/shared/...`.
- **Russian copy & label map (single source of truth — use these exact strings):**

  | Location                                        | String                                                                                                               |
  | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
  | Header add-widget button (visible)              | `Добавить виджет`                                                                                                    |
  | Theme group `aria-label`                        | `Тема`                                                                                                               |
  | Theme item `aria-label` — light / dark / system | `Светлая тема` / `Тёмная тема` / `Системная тема`                                                                    |
  | Catalog popover title                           | `Каталог виджетов`                                                                                                   |
  | Catalog close `aria-label`                      | `Закрыть`                                                                                                            |
  | Catalog search `placeholder`                    | `Поиск виджетов`                                                                                                     |
  | Catalog count (mono, uppercase)                 | `Доступные · {N}`                                                                                                    |
  | Catalog row add-button `aria-label`             | `Добавить: {title}`                                                                                                  |
  | Catalog footer note                             | `Каждый виджет работает изолированно`                                                                                |
  | Board card fullscreen `aria-label`              | `Развернуть`                                                                                                         |
  | Board card remove `aria-label`                  | `Удалить`                                                                                                            |
  | Empty heading                                   | `Начните с первого виджета`                                                                                          |
  | Empty description                               | `Добавляйте виджеты из каталога, свободно перемещайте их и меняйте размер. Раскладка сохранится на этом устройстве.` |
  | Empty primary button                            | `Добавить виджет`                                                                                                    |
  | Empty secondary button                          | `Открыть каталог`                                                                                                    |
  | Overlay close `aria-label`                      | `Закрыть`                                                                                                            |
  | Overlay size badge                              | `large`                                                                                                              |
  | Error card title                                | `Виджет не отвечает`                                                                                                 |
  | Error card subtext (boundary)                   | `Не удалось загрузить виджет`                                                                                        |
  | Error retry button                              | `Повторить`                                                                                                          |
  | Error delete button                             | `Удалить`                                                                                                            |
  | Registry `clock`                                | title `Часы`, description `Текущее время и дата`                                                                     |
  | Registry `ofelia-poop-duty`                     | title `Лоток Офелии`, description `Чья сегодня очередь убирать`                                                      |

- **Verification commands** (run from repo root unless noted):
  - Single test file: `pnpm --filter client exec vitest run <relative/path.test.tsx>`
  - Full client suite: `pnpm --filter client exec vitest run`
  - Typecheck: `pnpm --filter client typecheck`
  - E2E typecheck: `pnpm --filter client typecheck:e2e`
  - E2E: `pnpm --filter client test:e2e`
- **PR gate (must hold before opening the PR):** `pnpm test`, `pnpm typecheck`, and `pnpm --filter client typecheck:e2e` green; `pnpm test:e2e` green for board/theme flows; include before/after screenshots (UI change).

---

## File Structure

**Rewrite (full file replacement):**

- `client/src/shared/theme/tokens.css` — single semantic + app token layer, keyed to `data-theme`.
- `client/src/app/global.css` — Tailwind imports, font imports, `data-theme` dark variant, `@theme inline`, flat body, kept keyframes/guards.

**Add (shadcn primitives, `reatomMemo`-wrapped):**

- `client/src/components/ui/input.tsx`
- `client/src/components/ui/badge.tsx`
- `client/src/components/ui/separator.tsx`
- `client/src/components/ui/skeleton.tsx`
- `client/src/components/ui/popover.tsx`
- `client/src/components/ui/dialog.tsx`
- `client/src/components/ui/toggle-group.tsx`
- `client/src/components/ui/primitives.test.tsx` — smoke test for the new primitives.

**Edit (model):**

- `client/src/widget-registry/model/registry.ts` — `description` field + Russian titles/descriptions.
- `client/src/board/model/add-widget-menu-model.ts` — `catalogQuery` atom + `filteredWidgetTypes` computed + query-clearing close.

**Edit (ui + module.css):**

- `client/src/app/ui/Header.tsx` (+ `Header.module.css`)
- `client/src/theme/ui/ThemeToggle.tsx` (+ `ThemeToggle.module.css`)
- `client/src/board/ui/AddWidgetMenu.tsx` (+ `AddWidgetMenu.module.css`)
- `client/src/widget-host/ui/WidgetFrame.tsx`, `WidgetErrorBoundary.tsx` (+ `WidgetFrame.module.css`)
- `client/src/board/ui/Board.tsx` (+ `Board.module.css`)
- `client/src/board/ui/EmptyState.tsx` (+ `EmptyState.module.css`)
- `client/src/widget-host/ui/FullscreenOverlay.tsx` (+ `FullscreenOverlay.module.css`)

**Edit (deps + tests + e2e):**

- `client/package.json` — add Hanken Grotesk + JetBrains Mono fontsource; remove Fraunces/Nunito/Geist.
- Tests: `registry.test.ts`, `add-widget-menu-model.test.ts`, `Header.test.tsx`, `ThemeToggle.test.tsx`, `AddWidgetMenu.test.tsx`, `WidgetFrame.test.tsx`, `WidgetErrorBoundary.test.tsx`, `Board.test.tsx`, `FullscreenOverlay.test.tsx`, new `EmptyState.test.tsx`.
- E2E: `client/e2e/pages/HeaderPage.ts`, `BoardPage.ts`, `OverlayPage.ts`, `client/e2e/widget-interactions.spec.ts`.

---

## Task 0: Baseline screenshots (before code changes)

Do this before Task 1 and before any implementation edits. This makes the PR's before/after screenshots reproducible without checking out an old commit later.

**Files:** screenshot artifacts only under `docs/superpowers/artifacts/2026-06-18-myboard-design-update/`.

- [ ] **Step 1: Create the artifact directories**

Run:

```powershell
New-Item -ItemType Directory -Force -Path docs/superpowers/artifacts/2026-06-18-myboard-design-update/before
New-Item -ItemType Directory -Force -Path docs/superpowers/artifacts/2026-06-18-myboard-design-update/after
```

- [ ] **Step 2: Capture the current UI**

Boot the current app with `pnpm dev`. Use a Playwright-controlled browser (or equivalent in-app browser automation) and save each file with `page.screenshot({ path, fullPage: true })` into `docs/superpowers/artifacts/2026-06-18-myboard-design-update/before/`.

For Playwright, create the screenshot context with fixed viewport, locale, timezone, and browser time before navigation:

```ts
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  locale: 'ru-RU',
  timezoneId: 'Europe/Warsaw',
})
const page = await context.newPage()
await page.clock.setFixedTime('2026-06-18T12:00:00+02:00')
```

Use this storage snapshot for board screenshots:

```ts
const boardSnapshot = {
  instances: [
    { id: 'shot-clock', typeId: 'clock' },
    { id: 'shot-ofelia', typeId: 'ofelia-poop-duty' },
  ],
  layout: [
    { i: 'shot-clock', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    { i: 'shot-ofelia', x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  ],
}
```

Use this storage snapshot for the error screenshot:

```ts
const errorSnapshot = {
  instances: [{ id: 'shot-error', typeId: 'missing' }],
  layout: [{ i: 'shot-error', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 }],
}
```

Before each screenshot, run `localStorage.clear()`, set `localStorage.setItem('myboard.theme', '<theme>')` with the concrete theme value listed below (`light` or `dark`), set `localStorage.setItem('myboard.board', JSON.stringify(snapshot))` only for board/error shots, then reload and wait for the page to settle.

- `empty-light.png`: theme `light`, no board snapshot.
- `empty-dark.png`: theme `dark`, no board snapshot.
- `board-light.png`: theme `light`, `boardSnapshot`.
- `board-dark.png`: theme `dark`, `boardSnapshot`.
- `catalog-light.png`: theme `light`, no board snapshot, reload, click the current header trigger with `page.getByRole('banner').getByRole('button', { name: 'Add widget' })`, capture the open menu.
- `overlay-light.png`: theme `light`, `boardSnapshot`, reload, click the first card's current `Expand` button, capture the open overlay.
- `error-light.png`: theme `light`, `errorSnapshot`, reload, capture the unknown-widget error card.

If any surface cannot be reached in the current UI, add `before/notes.md` with the exact missing surface and reason instead of inventing a fake state. These screenshots/notes are PR evidence only; do not commit application code in this task.

---

## Task 1: Design-token foundation (fonts + tokens + dark-mode fix)

Pure styling/config change — the load-bearing part of the spec. There is no clean jsdom unit test for CSS-variable resolution, so this task's gate is: existing theme tests still pass + typecheck + the app boots. The real "dark tokens resolve" assertion is added later in Task 11 (Playwright, real browser).

**Files:**

- Modify: `client/package.json`
- Rewrite: `client/src/shared/theme/tokens.css`
- Rewrite: `client/src/app/global.css`

**Interfaces:**

- Produces (CSS custom properties available app-wide, both themes): shadcn semantic — `--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --border --input --ring --radius`; app-specific — `--board --border-strong --text-3 --accent-soft --scrim --success --dot-grid --shadow-card --shadow-overlay --ease`; fonts — `--font-sans` (`'Hanken Grotesk Variable'…`), `--font-mono` (`'JetBrains Mono Variable'…`). Also keep compatibility aliases for untouched widget internals: `--surface --text --text-dim --font-ui --font-display --accent-2`.
- The `dark:` Tailwind variant now activates under `[data-theme='dark']`.

- [ ] **Step 1: Swap font dependencies**

Run (from repo root):

```bash
pnpm --filter client add @fontsource-variable/hanken-grotesk @fontsource-variable/jetbrains-mono
pnpm --filter client remove @fontsource-variable/fraunces @fontsource-variable/nunito @fontsource-variable/geist
```

Expected: `client/package.json` `dependencies` now lists `@fontsource-variable/hanken-grotesk` and `@fontsource-variable/jetbrains-mono`, and no longer lists fraunces/nunito/geist.

- [ ] **Step 2: Rewrite `tokens.css`**

Replace the entire contents of `client/src/shared/theme/tokens.css` with:

```css
:root,
:root[data-theme='light'] {
  color-scheme: light;

  /* shadcn semantic tokens */
  --background: oklch(0.975 0.003 255);
  --foreground: oklch(0.27 0.02 262);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.27 0.02 262);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.27 0.02 262);
  --primary: oklch(0.55 0.17 281);
  --primary-foreground: #ffffff;
  --secondary: oklch(0.972 0.004 255);
  --secondary-foreground: oklch(0.5 0.018 262);
  --muted: oklch(0.972 0.004 255);
  --muted-foreground: oklch(0.5 0.018 262);
  --accent: oklch(0.972 0.004 255);
  --accent-foreground: oklch(0.27 0.02 262);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.91 0.005 255);
  --input: oklch(0.91 0.005 255);
  --ring: oklch(0.55 0.17 281);

  /* app-specific tokens */
  --board: oklch(0.96 0.004 255);
  --border-strong: oklch(0.84 0.006 255);
  --text-3: oklch(0.66 0.012 262);
  --accent-soft: oklch(0.955 0.032 285);
  --scrim: oklch(0.45 0.02 262 / 0.34);
  --success: oklch(0.7 0.16 150);
  --dot-grid: oklch(0.84 0.006 255);
  --shadow-card: 0 1px 2px rgba(20, 22, 40, 0.05), 0 2px 8px rgba(20, 22, 40, 0.05);
  --shadow-overlay: 0 24px 50px -18px rgba(30, 32, 55, 0.22);
}

:root[data-theme='dark'] {
  color-scheme: dark;

  --background: oklch(0.19 0.008 262);
  --foreground: oklch(0.95 0.005 262);
  --card: oklch(0.225 0.01 262);
  --card-foreground: oklch(0.95 0.005 262);
  --popover: oklch(0.225 0.01 262);
  --popover-foreground: oklch(0.95 0.005 262);
  --primary: oklch(0.68 0.15 285);
  --primary-foreground: oklch(0.18 0.03 285);
  --secondary: oklch(0.26 0.012 262);
  --secondary-foreground: oklch(0.72 0.012 262);
  --muted: oklch(0.26 0.012 262);
  --muted-foreground: oklch(0.72 0.012 262);
  --accent: oklch(0.26 0.012 262);
  --accent-foreground: oklch(0.95 0.005 262);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(0.3 0.012 262);
  --input: oklch(0.3 0.012 262);
  --ring: oklch(0.68 0.15 285);

  --board: oklch(0.165 0.008 262);
  --border-strong: oklch(0.36 0.014 262);
  --text-3: oklch(0.55 0.012 262);
  --accent-soft: oklch(0.32 0.07 285);
  --scrim: oklch(0.1 0.01 262 / 0.62);
  --success: oklch(0.72 0.16 150);
  --dot-grid: oklch(0.36 0.014 262);
  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 10px rgba(0, 0, 0, 0.35);
  --shadow-overlay: 0 24px 70px rgba(0, 0, 0, 0.55);
}

:root {
  --radius: 0.625rem;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);

  /* Compatibility for existing widget internals; do not use in new host chrome. */
  --surface: var(--card);
  --text: var(--foreground);
  --text-dim: var(--muted-foreground);
  --font-ui: 'Hanken Grotesk Variable', system-ui, sans-serif;
  --font-display: 'Hanken Grotesk Variable', system-ui, sans-serif;
  --accent-2: var(--primary);
}
```

- [ ] **Step 3: Rewrite `global.css`**

Replace the entire contents of `client/src/app/global.css` with (note: font imports and font `@theme inline` tokens live here; the greyscale `:root{}`/`.dark{}` blocks and sidebar/chart mappings are removed; the dark variant now tracks `data-theme`):

```css
@import 'tailwindcss';
@import '../shared/theme/tokens.css';
@import 'react-grid-layout/css/styles.css';
@import 'react-resizable/css/styles.css';
@import 'tw-animate-css';
@import 'shadcn/tailwind.css';
@import '@fontsource-variable/hanken-grotesk';
@import '@fontsource-variable/jetbrains-mono';

@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));

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
  background-color: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  transition:
    background-color 0.45s var(--ease),
    color 0.45s var(--ease);
}

body[data-board-interacting='true'],
body[data-board-interacting='true'] * {
  user-select: none !important;
}

body[data-board-interacting='true'] [data-widget-surface] {
  pointer-events: none;
}

.react-grid-item.react-grid-placeholder {
  background: var(--primary) !important;
  opacity: 0.18;
  border-radius: 14px;
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

@theme inline {
  --font-sans: 'Hanken Grotesk Variable', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono Variable', ui-monospace, monospace;
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --color-foreground: var(--foreground);
  --color-background: var(--background);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
```

- [ ] **Step 4: Verify existing theme tests still pass**

Run:

```bash
pnpm --filter client exec vitest run src/theme
```

Expected: PASS (`theme-model`, `resolve-theme`, `theme-storage`, `ThemeToggle` suites green — `data-theme` still flips light/dark/system).

- [ ] **Step 5: Verify typecheck and that the app boots**

Run:

```bash
pnpm --filter client typecheck
```

Expected: PASS (no type errors).

Then boot the dev server briefly to confirm CSS compiles (no Tailwind/`@import`/`@theme` errors) and fonts load:

```bash
pnpm --filter client exec vite build
```

Expected: build succeeds with no unresolved `@import` (Hanken Grotesk + JetBrains Mono resolve; no Fraunces/Nunito/Geist references remain).

- [ ] **Step 6: Commit**

```bash
git add client/package.json pnpm-lock.yaml client/src/shared/theme/tokens.css client/src/app/global.css
git commit -m "feat(client): replace theme tokens with mockup palette and fix dark mode"
```

(Root `pnpm-lock.yaml` is the workspace lockfile. Do not add `client/pnpm-lock.yaml` unless a future repo change creates it.)

---

## Task 2: shadcn primitives

Add the seven primitives the spec requires, each defined with `reatomMemo` (radix-primitive re-exports exempt). One smoke test renders each so a reviewer can reject a broken primitive independently.

**Files:**

- Create: `client/src/components/ui/input.tsx`
- Create: `client/src/components/ui/badge.tsx`
- Create: `client/src/components/ui/separator.tsx`
- Create: `client/src/components/ui/skeleton.tsx`
- Create: `client/src/components/ui/popover.tsx`
- Create: `client/src/components/ui/dialog.tsx`
- Create: `client/src/components/ui/toggle-group.tsx`
- Create: `client/src/components/ui/primitives.test.tsx`

**Interfaces:**

- Consumes: `cn` from `@/lib/utils`, `reatomMemo` from `@/shared/reatom/reatom-memo`, unified `radix-ui` package (verified to export `Popover`, `Dialog`, `ToggleGroup`, `Separator`, `Slot`).
- Produces (named exports later tasks import):
  - `input.tsx`: `Input`
  - `badge.tsx`: `Badge`, `badgeVariants`
  - `separator.tsx`: `Separator`
  - `skeleton.tsx`: `Skeleton`
  - `popover.tsx`: `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`, `PopoverArrow`
  - `dialog.tsx`: `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogClose`, `DialogOverlay`, `DialogContent`, `DialogTitle`, `DialogDescription`
  - `toggle-group.tsx`: `ToggleGroup`, `ToggleGroupItem`

- [ ] **Step 1: Write the failing smoke test**

Create `client/src/components/ui/primitives.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Input } from './input'
import { Badge } from './badge'
import { Separator } from './separator'
import { Skeleton } from './skeleton'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './dialog'

describe('ui primitives', () => {
  it('renders Input, Badge, Separator and Skeleton', () => {
    render(
      <div>
        <Input placeholder="q" />
        <Badge>x</Badge>
        <Separator />
        <Skeleton className="h-4 w-4" />
      </div>,
    )
    expect(screen.getByPlaceholderText('q')).toBeInTheDocument()
    expect(screen.getByText('x')).toBeInTheDocument()
  })

  it('renders a single-select ToggleGroup', () => {
    render(
      <ToggleGroup type="single" defaultValue="a">
        <ToggleGroupItem value="a" aria-label="opt a">
          A
        </ToggleGroupItem>
      </ToggleGroup>,
    )
    expect(screen.getByRole('button', { name: 'opt a' })).toBeInTheDocument()
  })

  it('opens a Popover on trigger click', async () => {
    render(
      <Popover>
        <PopoverTrigger>open</PopoverTrigger>
        <PopoverContent>inside</PopoverContent>
      </Popover>,
    )
    fireEvent.click(screen.getByText('open'))
    expect(await screen.findByText('inside')).toBeInTheDocument()
  })

  it('opens a Dialog on trigger click', async () => {
    render(
      <Dialog>
        <DialogTrigger>open dialog</DialogTrigger>
        <DialogContent>
          <DialogTitle>title</DialogTitle>
          body
        </DialogContent>
      </Dialog>,
    )
    fireEvent.click(screen.getByText('open dialog'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter client exec vitest run src/components/ui/primitives.test.tsx
```

Expected: FAIL — cannot resolve `./input`, `./badge`, etc. (modules not created yet).

- [ ] **Step 3: Create `input.tsx`**

```tsx
import * as React from 'react'

import { cn } from '@/lib/utils'
import { reatomMemo } from '@/shared/reatom/reatom-memo'

const Input = reatomMemo<React.ComponentProps<'input'>>(({ className, type, ...props }) => {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}, 'Input')

export { Input }
```

- [ ] **Step 4: Create `badge.tsx`**

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'
import { reatomMemo } from '@/shared/reatom/reatom-memo'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive/10 text-destructive',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

type BadgeProps = React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }

const Badge = reatomMemo<BadgeProps>(({ className, variant, asChild = false, ...props }) => {
  const Comp = asChild ? Slot.Root : 'span'
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}, 'Badge')

export { Badge, badgeVariants }
```

- [ ] **Step 5: Create `separator.tsx`**

```tsx
import * as React from 'react'
import { Separator as SeparatorPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'
import { reatomMemo } from '@/shared/reatom/reatom-memo'

const Separator = reatomMemo<React.ComponentProps<typeof SeparatorPrimitive.Root>>(
  ({ className, orientation = 'horizontal', decorative = true, ...props }) => {
    return (
      <SeparatorPrimitive.Root
        data-slot="separator"
        decorative={decorative}
        orientation={orientation}
        className={cn(
          'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
          className,
        )}
        {...props}
      />
    )
  },
  'Separator',
)

export { Separator }
```

- [ ] **Step 6: Create `skeleton.tsx`**

```tsx
import * as React from 'react'

import { cn } from '@/lib/utils'
import { reatomMemo } from '@/shared/reatom/reatom-memo'

const Skeleton = reatomMemo<React.ComponentProps<'div'>>(({ className, ...props }) => {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-accent', className)}
      {...props}
    />
  )
}, 'Skeleton')

export { Skeleton }
```

- [ ] **Step 7: Create `popover.tsx`**

```tsx
import * as React from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'
import { reatomMemo } from '@/shared/reatom/reatom-memo'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverArrow = reatomMemo<React.ComponentProps<typeof PopoverPrimitive.Arrow>>(
  ({ className, ...props }) => {
    return (
      <PopoverPrimitive.Arrow
        data-slot="popover-arrow"
        className={cn('fill-popover', className)}
        {...props}
      />
    )
  },
  'PopoverArrow',
)

const PopoverContent = reatomMemo<React.ComponentProps<typeof PopoverPrimitive.Content>>(
  ({ className, align = 'center', sideOffset = 4, ...props }) => {
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="popover-content"
          align={align}
          sideOffset={sideOffset}
          className={cn(
            'z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Portal>
    )
  },
  'PopoverContent',
)

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverArrow }
```

- [ ] **Step 8: Create `dialog.tsx`**

```tsx
import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'
import { reatomMemo } from '@/shared/reatom/reatom-memo'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = reatomMemo<React.ComponentProps<typeof DialogPrimitive.Overlay>>(
  ({ className, ...props }) => {
    return (
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn(
          'fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      />
    )
  },
  'DialogOverlay',
)

const DialogContent = reatomMemo<
  React.ComponentProps<typeof DialogPrimitive.Content> & { overlayClassName?: string }
>(({ className, overlayClassName, children, ...props }) => {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-card text-card-foreground outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}, 'DialogContent')

const DialogTitle = reatomMemo<React.ComponentProps<typeof DialogPrimitive.Title>>(
  ({ className, ...props }) => {
    return (
      <DialogPrimitive.Title
        data-slot="dialog-title"
        className={cn('text-base leading-none font-semibold', className)}
        {...props}
      />
    )
  },
  'DialogTitle',
)

const DialogDescription = reatomMemo<React.ComponentProps<typeof DialogPrimitive.Description>>(
  ({ className, ...props }) => {
    return (
      <DialogPrimitive.Description
        data-slot="dialog-description"
        className={cn('text-sm text-muted-foreground', className)}
        {...props}
      />
    )
  },
  'DialogDescription',
)

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
}
```

- [ ] **Step 9: Create `toggle-group.tsx`**

```tsx
import * as React from 'react'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'
import { reatomMemo } from '@/shared/reatom/reatom-memo'

const ToggleGroup = reatomMemo<React.ComponentProps<typeof ToggleGroupPrimitive.Root>>(
  ({ className, children, ...props }) => {
    return (
      <ToggleGroupPrimitive.Root
        data-slot="toggle-group"
        className={cn('group/toggle-group flex w-fit items-center', className)}
        {...props}
      >
        {children}
      </ToggleGroupPrimitive.Root>
    )
  },
  'ToggleGroup',
)

const ToggleGroupItem = reatomMemo<React.ComponentProps<typeof ToggleGroupPrimitive.Item>>(
  ({ className, children, ...props }) => {
    return (
      <ToggleGroupPrimitive.Item
        data-slot="toggle-group-item"
        className={cn(
          'inline-flex items-center justify-center outline-none disabled:pointer-events-none disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </ToggleGroupPrimitive.Item>
    )
  },
  'ToggleGroupItem',
)

export { ToggleGroup, ToggleGroupItem }
```

- [ ] **Step 10: Run the smoke test to verify it passes**

Run:

```bash
pnpm --filter client exec vitest run src/components/ui/primitives.test.tsx
```

Expected: PASS (all four cases). Then typecheck:

```bash
pnpm --filter client typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add client/src/components/ui client/package.json
git commit -m "feat(client): add shadcn input, badge, separator, skeleton, popover, dialog, toggle-group"
```

---

## Task 3: Registry — descriptions + Russian titles

**Files:**

- Modify: `client/src/widget-registry/model/registry.ts`
- Test: `client/src/widget-registry/model/registry.test.ts`
- Test: `client/src/widget-host/ui/WidgetFrame.test.tsx` (mock `WidgetType` gets `description` immediately so typecheck stays green after this task)

**Interfaces:**

- Produces: `WidgetType` now has `description: string`. `clock` → `{ title: 'Часы', description: 'Текущее время и дата' }`; `ofelia-poop-duty` → `{ title: 'Лоток Офелии', description: 'Чья сегодня очередь убирать' }`. (Catalog, overlay subtitle, and board titles consume these.)

- [ ] **Step 1: Update the failing test**

Edit `client/src/widget-registry/model/registry.test.ts`. Replace the `loads the Ofelia poop duty widget` `toMatchObject` block and add description assertions:

```tsx
it('loads the Ofelia poop duty widget', async () => {
  const type = findWidgetType('ofelia-poop-duty')
  if (type instanceof Error) throw type

  expect(type).not.toHaveProperty('entry')
  expect(typeof type.loadComponent).toBe('function')
  expect(type).toMatchObject({
    id: 'ofelia-poop-duty',
    title: 'Лоток Офелии',
    description: 'Чья сегодня очередь убирать',
    defaultSize: { w: 3, h: 2 },
    icon: 'CalendarDays',
  })

  const mod = await type.loadComponent()
  expect(mod.default).toEqual(
    expect.objectContaining({ $$typeof: expect.any(Symbol), type: expect.any(Function) }),
  )
})

it('gives every widget a Russian title and description', () => {
  const clock = findWidgetType('clock')
  if (clock instanceof Error) throw clock
  expect(clock.title).toBe('Часы')
  expect(clock.description).toBe('Текущее время и дата')
  for (const type of widgetTypes) {
    expect(type.description.length).toBeGreaterThan(0)
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter client exec vitest run src/widget-registry/model/registry.test.ts
```

Expected: FAIL — `description` is `undefined` and `title` is `Какахи Офелии` / `Clock`.

- [ ] **Step 3: Update `registry.ts`**

Add `description` to the type and populate both entries:

```tsx
export type WidgetType = {
  id: string
  title: string
  /** One-line catalog/overlay subtitle. */
  description: string
  loadComponent: WidgetLoader
  defaultSize: { w: number; h: number }
  /** lucide-react icon name used in the catalog menu. */
  icon: WidgetIconName
}
```

```tsx
export const widgetTypes: WidgetType[] = [
  {
    id: 'clock',
    title: 'Часы',
    description: 'Текущее время и дата',
    loadComponent: () =>
      import('../../../widgets/clock/ui/Clock').then((mod) => ({ default: mod.Clock })),
    defaultSize: { w: 3, h: 2 },
    icon: 'Clock',
  },
  {
    id: 'ofelia-poop-duty',
    title: 'Лоток Офелии',
    description: 'Чья сегодня очередь убирать',
    loadComponent: () =>
      import('../../../widgets/ofelia-poop-duty/ui/OfeliaPoopDuty').then((mod) => ({
        default: mod.OfeliaPoopDuty,
      })),
    defaultSize: { w: 3, h: 2 },
    icon: 'CalendarDays',
  },
]
```

- [ ] **Step 4: Update the WidgetFrame mock type**

In `client/src/widget-host/ui/WidgetFrame.test.tsx`, add `description` to the loading-skeleton mock `WidgetType` object literal so this task does not leave typecheck broken:

```tsx
vi.mocked(findWidgetType).mockReturnValue({
  id: 'clock',
  title: 'Clock',
  description: 'Текущее время и дата',
  loadComponent: () => new Promise<never>(() => {}),
  defaultSize: { w: 3, h: 2 },
  icon: 'Clock',
})
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
pnpm --filter client exec vitest run src/widget-registry/model/registry.test.ts src/widget-host/ui/WidgetFrame.test.tsx
pnpm --filter client typecheck
```

Expected: PASS (the updated public `WidgetType` shape is accepted repo-wide; no intermediate commit leaves typecheck broken).

- [ ] **Step 6: Commit**

```bash
git add client/src/widget-registry/model/registry.ts client/src/widget-registry/model/registry.test.ts client/src/widget-host/ui/WidgetFrame.test.tsx
git commit -m "feat(client): add widget descriptions and Russian catalog titles"
```

---

## Task 4: Header

**Files:**

- Modify: `client/src/app/ui/Header.tsx`
- Modify: `client/src/app/ui/Header.module.css`
- Test: `client/src/app/ui/Header.test.tsx`

**Interfaces:**

- Consumes: `ThemeToggle`, `AddWidgetMenu` (unchanged imports). The add-widget button text becomes `Добавить виджет` (provided by `AddWidgetMenu` in Task 6); Header itself drops the `LayoutGrid` icon and renders the two-tone text logo.

- [ ] **Step 1: Update the failing test**

Edit `client/src/app/ui/Header.test.tsx` so this task only checks the header-owned logo change. Keep the theme-group assertion on the current English label until Task 5 rewrites `ThemeToggle`:

```tsx
describe('Header', () => {
  it('renders brand, theme toggle and the add-widget control', () => {
    render(<Header />)
    expect(screen.getByText('board')).toBeInTheDocument()
    expect(screen.getByText('my')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /theme/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter client exec vitest run src/app/ui/Header.test.tsx
```

Expected: FAIL — `getByText('board')`/`getByText('my')` not found (logo currently renders `myboard` as one span).

- [ ] **Step 3: Rewrite `Header.tsx`**

```tsx
import { AddWidgetMenu } from '../../board/ui/AddWidgetMenu'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import { ThemeToggle } from '../../theme/ui/ThemeToggle'
import styles from './Header.module.css'

export const Header = reatomMemo(() => {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.logo}>
          <span className={styles.logoMuted}>my</span>
          <span className={styles.logoStrong}>board</span>
        </span>
      </div>
      <div className={styles.actions}>
        <ThemeToggle />
        <AddWidgetMenu />
      </div>
    </header>
  )
}, 'Header')
```

- [ ] **Step 4: Rewrite `Header.module.css`**

```css
.header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 54px;
  padding: 0 20px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
}

.logo {
  font-family: var(--font-sans);
  font-weight: 700;
  font-size: 19px;
  letter-spacing: -0.01em;
}
.logoMuted {
  color: var(--text-3);
}
.logoStrong {
  color: var(--foreground);
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
pnpm --filter client exec vitest run src/app/ui/Header.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/app/ui/Header.tsx client/src/app/ui/Header.module.css client/src/app/ui/Header.test.tsx
git commit -m "feat(client): restyle header with two-tone logo and flat card bar"
```

---

## Task 5: ThemeToggle (ToggleGroup)

**Files:**

- Modify: `client/src/theme/ui/ThemeToggle.tsx`
- Modify: `client/src/theme/ui/ThemeToggle.module.css`
- Test: `client/src/theme/ui/ThemeToggle.test.tsx`
- Modify: `client/src/app/ui/Header.test.tsx` (integration label update after the theme group is renamed)

**Interfaces:**

- Consumes: `ToggleGroup`, `ToggleGroupItem` from `@/components/ui/toggle-group`; `themeMode` atom. Group `aria-label` = `Тема`; item `aria-label`s = `Светлая тема`/`Тёмная тема`/`Системная тема`; each item keeps explicit `aria-pressed` and the View-Transition reveal.

- [ ] **Step 1: Update the failing test**

Replace `client/src/theme/ui/ThemeToggle.test.tsx` with Russian labels:

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { themeMode } from '../model/theme-model'
import { ThemeToggle } from './ThemeToggle'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('ThemeToggle', () => {
  it('renders a button per mode inside the Тема group', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('group', { name: 'Тема' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Светлая тема' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Тёмная тема' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Системная тема' })).toBeInTheDocument()
  })

  it('sets the theme mode on click', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'Тёмная тема' }))
    expect(themeMode()).toBe('dark')
  })

  it('marks the active mode with aria-pressed', async () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'Тёмная тема' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Тёмная тема' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter client exec vitest run src/theme/ui/ThemeToggle.test.tsx
```

Expected: FAIL — labels are currently English (`Light`/`Dark`/`System theme`), group name `Theme`.

- [ ] **Step 3: Rewrite `ThemeToggle.tsx`**

Preserve `setMode` (coords + `startViewTransition` + reduced-motion) exactly; render via `ToggleGroup`. Use per-item `onClick` to keep the View Transition (the controlled `value` comes from the atom, so `onValueChange` is unnecessary):

```tsx
import { wrap } from '@reatom/core'
import type { MouseEvent } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import type { ThemeMode } from '../../shared/theme/types'
import { themeMode } from '../model/theme-model'
import styles from './ThemeToggle.module.css'

const OPTIONS: { mode: ThemeMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'light', label: 'Светлая тема', Icon: Sun },
  { mode: 'dark', label: 'Тёмная тема', Icon: Moon },
  { mode: 'system', label: 'Системная тема', Icon: Monitor },
]

function setMode(mode: ThemeMode, event: MouseEvent) {
  const root = document.documentElement
  root.style.setProperty('--vt-x', `${event.clientX}px`)
  root.style.setProperty('--vt-y', `${event.clientY}px`)

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const startViewTransition = (
    document as Document & { startViewTransition?: (cb: () => void) => void }
  ).startViewTransition
  const applyMode = wrap(() => themeMode.set(mode))

  if (startViewTransition && !prefersReducedMotion) {
    startViewTransition.call(document, applyMode)
  } else {
    applyMode()
  }
}

export const ThemeToggle = reatomMemo(() => {
  const current = themeMode()
  return (
    <ToggleGroup type="single" value={current} aria-label="Тема" className={styles.group}>
      {OPTIONS.map(({ mode, label, Icon }) => (
        <ToggleGroupItem
          key={mode}
          value={mode}
          className={styles.item}
          aria-label={label}
          aria-pressed={current === mode}
          onClick={wrap((event: MouseEvent) => setMode(mode, event))}
        >
          <Icon size={16} strokeWidth={2.2} aria-hidden />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}, 'ThemeToggle')
```

- [ ] **Step 4: Rewrite `ThemeToggle.module.css`**

```css
.group {
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--background);
}

.item {
  display: grid;
  place-items: center;
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition:
    color 0.15s var(--ease),
    background 0.15s var(--ease),
    box-shadow 0.15s var(--ease);
}
.item:hover {
  color: var(--foreground);
}
.item[data-state='on'] {
  background: var(--card);
  color: var(--foreground);
  box-shadow: var(--shadow-card);
}
.item:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
pnpm --filter client exec vitest run src/theme/ui/ThemeToggle.test.tsx
```

Expected: PASS (3 cases).

- [ ] **Step 6: Update the Header integration assertion**

Now that `ThemeToggle` exposes the Russian group label, update `client/src/app/ui/Header.test.tsx` so the integration test no longer keeps the temporary English selector from Task 4:

```tsx
describe('Header', () => {
  it('renders brand, theme toggle and the add-widget control', () => {
    render(<Header />)
    expect(screen.getByText('board')).toBeInTheDocument()
    expect(screen.getByText('my')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Тема' })).toBeInTheDocument()
  })
})
```

Run:

```bash
pnpm --filter client exec vitest run src/app/ui/Header.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/theme/ui/ThemeToggle.tsx client/src/theme/ui/ThemeToggle.module.css client/src/theme/ui/ThemeToggle.test.tsx client/src/app/ui/Header.test.tsx
git commit -m "feat(client): render theme toggle as a segmented ToggleGroup"
```

---

## Task 6: Catalog (AddWidgetMenu) — Popover + search filter

**Files:**

- Modify: `client/src/board/model/add-widget-menu-model.ts`
- Test: `client/src/board/model/add-widget-menu-model.test.ts`
- Modify: `client/src/board/ui/AddWidgetMenu.tsx`
- Modify: `client/src/board/ui/AddWidgetMenu.module.css`
- Test: `client/src/board/ui/AddWidgetMenu.test.tsx`
- Modify: `client/src/app/ui/Header.test.tsx` (integration label update after the add button is renamed)

**Interfaces:**

- Consumes: `Popover`, `PopoverTrigger`, `PopoverContent` (Task 2); `Input` (Task 2); `widgetTypes` with `description` (Task 3); `addInstance` (board-model); `WIDGET_ICONS` map (`Clock`, `CalendarDays`).
- Produces (model): `catalogQuery` atom (`''`), `filteredWidgetTypes` computed (`WidgetType[]`), and `closeAddWidgetMenu` now also clears the query. `openAddWidgetMenu`/`toggleAddWidgetMenu` unchanged in signature.

- [ ] **Step 1: Extend the model test (failing)**

Append to `client/src/board/model/add-widget-menu-model.test.ts`:

```tsx
import { catalogQuery, filteredWidgetTypes } from './add-widget-menu-model'

describe('catalog search model', () => {
  it('returns all widgets when the query is empty', () => {
    catalogQuery.set('')
    expect(filteredWidgetTypes().length).toBeGreaterThanOrEqual(2)
  })

  it('filters by title and description, case-insensitively', () => {
    catalogQuery.set('часы')
    expect(filteredWidgetTypes().map((t) => t.id)).toEqual(['clock'])

    catalogQuery.set('очередь')
    expect(filteredWidgetTypes().map((t) => t.id)).toEqual(['ofelia-poop-duty'])
  })

  it('clears the query when the menu closes', () => {
    catalogQuery.set('часы')
    closeAddWidgetMenu()
    expect(catalogQuery()).toBe('')
  })
})
```

(Keep the existing `import { closeAddWidgetMenu, ... }` line; add `catalogQuery, filteredWidgetTypes` imports as shown.)

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
pnpm --filter client exec vitest run src/board/model/add-widget-menu-model.test.ts
```

Expected: FAIL — `catalogQuery`/`filteredWidgetTypes` are not exported.

- [ ] **Step 3: Rewrite `add-widget-menu-model.ts`**

```tsx
import { action, atom, computed, reatomBoolean } from '@reatom/core'
import { widgetTypes, type WidgetType } from '../../widget-registry/model/registry'

export const isAddWidgetMenuOpen = reatomBoolean(false, 'board.addWidgetMenu.open')
export const catalogQuery = atom('', 'board.addWidgetMenu.query')

export const filteredWidgetTypes = computed<WidgetType[]>(() => {
  const query = catalogQuery().trim().toLowerCase()
  if (!query) return widgetTypes
  return widgetTypes.filter(
    (type) =>
      type.title.toLowerCase().includes(query) || type.description.toLowerCase().includes(query),
  )
}, 'board.addWidgetMenu.filtered')

export const openAddWidgetMenu = isAddWidgetMenuOpen.setTrue
export const toggleAddWidgetMenu = isAddWidgetMenuOpen.toggle

export const closeAddWidgetMenu = action(() => {
  isAddWidgetMenuOpen.setFalse()
  catalogQuery.set('')
}, 'board.addWidgetMenu.close')
```

- [ ] **Step 4: Run the model test to verify it passes**

Run:

```bash
pnpm --filter client exec vitest run src/board/model/add-widget-menu-model.test.ts
```

Expected: PASS (original visibility test + 3 new cases).

- [ ] **Step 5: Rewrite the component test (failing for the new markup)**

Replace `client/src/board/ui/AddWidgetMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { instances } from '../model/board-model'
import { AddWidgetMenu } from './AddWidgetMenu'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

async function openCatalog() {
  render(<AddWidgetMenu />)
  fireEvent.click(screen.getByRole('button', { name: 'Добавить виджет' }))
  await screen.findByText('Каталог виджетов')
}

describe('AddWidgetMenu', () => {
  it('opens the catalog and lists widgets with descriptions', async () => {
    await openCatalog()
    expect(screen.getByText('Часы')).toBeInTheDocument()
    expect(screen.getByText('Текущее время и дата')).toBeInTheDocument()
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
  })

  it('adds a widget when its add button is clicked', async () => {
    await openCatalog()
    expect(instances()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить: Часы' }))
    expect(instances()).toHaveLength(1)
    expect(instances()[0]?.typeId).toBe('clock')
  })

  it('filters rows by the search query', async () => {
    await openCatalog()
    fireEvent.change(screen.getByPlaceholderText('Поиск виджетов'), {
      target: { value: 'очередь' },
    })
    await waitFor(() => {
      expect(screen.queryByText('Часы')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run:

```bash
pnpm --filter client exec vitest run src/board/ui/AddWidgetMenu.test.tsx
```

Expected: FAIL — current markup uses `role="menu"`/`menuitem` and English `Add widget`; no `Каталог виджетов`/search.

- [ ] **Step 7: Rewrite `AddWidgetMenu.tsx`**

```tsx
import { wrap } from '@reatom/core'
import { CalendarDays, Clock, Lock, Plus, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import type { WidgetIconName } from '../../widget-registry/model/registry'
import {
  catalogQuery,
  closeAddWidgetMenu,
  filteredWidgetTypes,
  isAddWidgetMenuOpen,
  openAddWidgetMenu,
} from '../model/add-widget-menu-model'
import { addInstance } from '../model/board-model'
import styles from './AddWidgetMenu.module.css'

const WIDGET_ICONS: Record<WidgetIconName, LucideIcon> = { Clock, CalendarDays }

export const AddWidgetMenu = reatomMemo(() => {
  const open = isAddWidgetMenuOpen()
  const query = catalogQuery()
  const types = filteredWidgetTypes()

  return (
    <Popover
      open={open}
      onOpenChange={wrap((next: boolean) => (next ? openAddWidgetMenu() : closeAddWidgetMenu()))}
    >
      <PopoverTrigger asChild>
        <Button className={styles.trigger}>
          <Plus size={16} strokeWidth={2.4} aria-hidden />
          Добавить виджет
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        className={styles.panel}
        onOpenAutoFocus={wrap((event: Event) => event.preventDefault())}
      >
        <div className={styles.head}>
          <span className={styles.headTitle}>Каталог виджетов</span>
          <button
            type="button"
            className={styles.close}
            aria-label="Закрыть"
            onClick={wrap(() => closeAddWidgetMenu())}
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <search className={styles.search}>
          <Input
            value={query}
            placeholder="Поиск виджетов"
            onChange={wrap((event) => catalogQuery.set(event.target.value))}
          />
        </search>

        <div className={styles.count}>Доступные · {types.length}</div>

        <ul className={styles.list}>
          {types.map((type) => {
            const Icon = WIDGET_ICONS[type.icon]
            return (
              <li key={type.id} className={styles.row}>
                <span className={styles.tile}>
                  <Icon size={18} strokeWidth={2} aria-hidden />
                </span>
                <span className={styles.meta}>
                  <span className={styles.title}>{type.title}</span>
                  <span className={styles.desc}>{type.description}</span>
                </span>
                <button
                  type="button"
                  className={styles.add}
                  aria-label={`Добавить: ${type.title}`}
                  onClick={wrap(() => {
                    const result = addInstance(type.id)
                    if (result instanceof Error) {
                      console.warn('Add widget failed:', result.message)
                      return
                    }
                    closeAddWidgetMenu()
                  })}
                >
                  <Plus size={16} strokeWidth={2.4} aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>

        <div className={styles.footer}>
          <Lock size={13} aria-hidden />
          Каждый виджет работает изолированно
        </div>
        <PopoverArrow className={styles.arrow} />
      </PopoverContent>
    </Popover>
  )
}, 'AddWidgetMenu')
```

- [ ] **Step 8: Rewrite `AddWidgetMenu.module.css`**

```css
.trigger {
  height: 36px;
  gap: 7px;
  padding: 0 16px;
  border-radius: 11px;
  box-shadow: var(--shadow-card);
}

.panel {
  width: 360px;
  padding: 0;
  overflow: hidden;
  border-radius: 14px;
  box-shadow: var(--shadow-overlay);
}

.arrow {
  fill: var(--popover);
  stroke: var(--border);
  stroke-width: 1px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.headTitle {
  font-weight: 700;
  font-size: 15px;
  color: var(--foreground);
}
.close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition:
    color 0.15s var(--ease),
    background 0.15s var(--ease);
}
.close:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.close:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.search {
  padding: 12px 16px 0;
}

.count {
  padding: 12px 16px 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0 12px 8px;
  list-style: none;
  max-height: 320px;
  overflow-y: auto;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 11px;
  transition:
    background 0.15s var(--ease),
    border-color 0.15s var(--ease);
}
.row:hover {
  background: var(--secondary);
}
.row:first-child {
  border-color: var(--primary);
  background: var(--accent-soft);
}

.tile {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 10px;
  background: var(--secondary);
  color: var(--foreground);
}
.row:first-child .tile {
  background: var(--card);
  color: var(--primary);
}

.meta {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.title {
  font-weight: 600;
  font-size: 14px;
  color: var(--foreground);
}
.desc {
  font-size: 12.5px;
  color: var(--muted-foreground);
}

.add {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--card);
  color: var(--foreground);
  cursor: pointer;
  transition:
    background 0.15s var(--ease),
    color 0.15s var(--ease),
    border-color 0.15s var(--ease);
}
.add:hover {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}
.add:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.footer {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-3);
}
```

- [ ] **Step 9: Run the component test to verify it passes**

Run:

```bash
pnpm --filter client exec vitest run src/board/ui/AddWidgetMenu.test.tsx
```

Expected: PASS (3 cases).

- [ ] **Step 10: Update the Header add-widget assertion**

Now that `AddWidgetMenu` exposes the Russian trigger label, extend `client/src/app/ui/Header.test.tsx` to verify the final header controls:

```tsx
describe('Header', () => {
  it('renders brand, theme toggle and the add-widget control', () => {
    render(<Header />)
    expect(screen.getByText('board')).toBeInTheDocument()
    expect(screen.getByText('my')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Тема' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить виджет' })).toBeInTheDocument()
  })
})
```

Run:

```bash
pnpm --filter client exec vitest run src/app/ui/Header.test.tsx src/board/ui/AddWidgetMenu.test.tsx
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add client/src/board/model/add-widget-menu-model.ts client/src/board/model/add-widget-menu-model.test.ts client/src/board/ui/AddWidgetMenu.tsx client/src/board/ui/AddWidgetMenu.module.css client/src/board/ui/AddWidgetMenu.test.tsx client/src/app/ui/Header.test.tsx
git commit -m "feat(client): rebuild add-widget catalog as a searchable Popover"
```

---

## Task 7: Widget states (WidgetFrame + WidgetErrorBoundary)

Do this **before** Board: Board passes the new `onDelete` prop.

**Files:**

- Modify: `client/src/widget-host/ui/WidgetErrorBoundary.tsx`
- Test: `client/src/widget-host/ui/WidgetErrorBoundary.test.tsx`
- Modify: `client/src/widget-host/ui/WidgetFrame.tsx`
- Modify: `client/src/widget-host/ui/WidgetFrame.module.css`
- Test: `client/src/widget-host/ui/WidgetFrame.test.tsx`

**Interfaces:**

- Consumes: `Badge` (Task 2), `Skeleton` (Task 2).
- Produces:
  - `WidgetErrorBoundary` props gain `onDelete?: () => void`; fallback shows title `Виджет не отвечает`, subtext `Не удалось загрузить виджет`, a warning `Badge` with `error.name`, `Повторить` (calls `onRetry`), and `Удалить` (calls `onDelete`, rendered only when provided).
  - `WidgetFrameProps` gains `onDelete?: () => void`. The unknown-type branch shows the same restyled card (title `Виджет не отвечает`, the error message, a `Удалить` button when `onDelete` is provided, no retry). Loading uses `Skeleton`.

- [ ] **Step 1: Update the error-boundary test (failing)**

Replace `client/src/widget-host/ui/WidgetErrorBoundary.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'

function Broken(): never {
  throw new Error('boom')
}

describe('WidgetErrorBoundary', () => {
  it('renders the restyled fallback and calls onError', () => {
    const onError = vi.fn()
    render(
      <WidgetErrorBoundary resetKey={0} onRetry={vi.fn()} onError={onError}>
        <Broken />
      </WidgetErrorBoundary>,
    )

    expect(screen.getByText('Виджет не отвечает')).toBeInTheDocument()
    expect(onError).toHaveBeenCalled()
  })

  it('calls retry from the fallback', () => {
    const onRetry = vi.fn()
    render(
      <WidgetErrorBoundary resetKey={0} onRetry={onRetry} onError={vi.fn()}>
        <Broken />
      </WidgetErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('calls onDelete when delete is clicked', () => {
    const onDelete = vi.fn()
    render(
      <WidgetErrorBoundary resetKey={0} onRetry={vi.fn()} onError={vi.fn()} onDelete={onDelete}>
        <Broken />
      </WidgetErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('omits the delete button when onDelete is not provided', () => {
    render(
      <WidgetErrorBoundary resetKey={0} onRetry={vi.fn()} onError={vi.fn()}>
        <Broken />
      </WidgetErrorBoundary>,
    )
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  })

  it('clears the error when resetKey changes', () => {
    const Good = () => <div>all good</div>
    const { rerender } = render(
      <WidgetErrorBoundary resetKey={0} onRetry={vi.fn()} onError={vi.fn()}>
        <Broken />
      </WidgetErrorBoundary>,
    )
    expect(screen.getByText('Виджет не отвечает')).toBeInTheDocument()

    rerender(
      <WidgetErrorBoundary resetKey={1} onRetry={vi.fn()} onError={vi.fn()}>
        <Good />
      </WidgetErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
pnpm --filter client exec vitest run src/widget-host/ui/WidgetErrorBoundary.test.tsx
```

Expected: FAIL — fallback text is `Widget failed to load`, retry label is `Retry`, no delete button.

- [ ] **Step 3: Rewrite `WidgetErrorBoundary.tsx`**

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import styles from './WidgetFrame.module.css'

type Props = {
  children: ReactNode
  resetKey: number
  onError: (error: Error) => void
  onRetry: () => void
  onDelete?: () => void
}

type State = { error: Error | null }

class WidgetErrorBoundaryView extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error)
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className={styles.errorCard}>
        <span className={styles.errorTile}>
          <AlertTriangle size={22} aria-hidden />
        </span>
        <div className={styles.errorTitle}>Виджет не отвечает</div>
        <div className={styles.errorText}>Не удалось загрузить виджет</div>
        <Badge variant="outline" className={styles.errorBadge}>
          {error.name}
        </Badge>
        <div className={styles.errorActions}>
          <button className={styles.retry} aria-label="Повторить" onClick={this.props.onRetry}>
            <RotateCw size={15} aria-hidden /> Повторить
          </button>
          {this.props.onDelete && (
            <button className={styles.delete} aria-label="Удалить" onClick={this.props.onDelete}>
              Удалить
            </button>
          )}
        </div>
      </div>
    )
  }
}

export const WidgetErrorBoundary = reatomMemo<Props>(
  (props) => <WidgetErrorBoundaryView {...props} />,
  'WidgetErrorBoundary',
)
```

- [ ] **Step 4: Update the WidgetFrame test (failing)**

Replace `client/src/widget-host/ui/WidgetFrame.test.tsx`:

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { findWidgetType, UnknownWidgetTypeError } from '../../widget-registry/model/registry'
import { WidgetFrame } from './WidgetFrame'

const holder = vi.hoisted(() => ({
  actual:
    null as unknown as (typeof import('../../widget-registry/model/registry'))['findWidgetType'],
}))

vi.mock('../../widget-registry/model/registry', async (importActual) => {
  const actual = await importActual<typeof import('../../widget-registry/model/registry')>()
  holder.actual = actual.findWidgetType
  return { ...actual, findWidgetType: vi.fn(actual.findWidgetType) }
})

beforeEach(() => {
  vi.mocked(findWidgetType).mockImplementation(holder.actual)
})

describe('WidgetFrame', () => {
  it('shows the restyled error card for an unknown widget type', () => {
    vi.mocked(findWidgetType).mockReturnValue(new UnknownWidgetTypeError({ typeId: 'missing' }))
    render(<WidgetFrame instanceId="inst-2" typeId="missing" mode="small" />)
    expect(screen.getByText('Виджет не отвечает')).toBeInTheDocument()
  })

  it('calls onDelete from the unknown-type card', () => {
    vi.mocked(findWidgetType).mockReturnValue(new UnknownWidgetTypeError({ typeId: 'missing' }))
    const onDelete = vi.fn()
    render(<WidgetFrame instanceId="inst-2" typeId="missing" mode="small" onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('renders the loadable widget component content', async () => {
    const { container } = render(<WidgetFrame instanceId="inst-1" typeId="clock" mode="small" />)
    expect(await screen.findByText(/:/)).toBeInTheDocument()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('shows the loading skeleton while the component is loading', () => {
    vi.mocked(findWidgetType).mockReturnValue({
      id: 'clock',
      title: 'Часы',
      description: 'Текущее время и дата',
      loadComponent: () => new Promise<never>(() => {}),
      defaultSize: { w: 3, h: 2 },
      icon: 'Clock',
    })
    const { container } = render(<WidgetFrame instanceId="inst-skel" typeId="clock" mode="small" />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  })
})
```

- [ ] **Step 5: Run to verify it fails**

Run:

```bash
pnpm --filter client exec vitest run src/widget-host/ui/WidgetFrame.test.tsx
```

Expected: FAIL — current unknown-type card says `Widget unavailable`, has no delete button, and the loading state is a `div` (no `data-slot="skeleton"`).

- [ ] **Step 6: Rewrite `WidgetFrame.tsx`**

```tsx
import { wrap } from '@reatom/core'
import { lazy, Suspense, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import { resolvedTheme } from '../../theme/model/theme-model'
import { findWidgetType } from '../../widget-registry/model/registry'
import type { WidgetMode } from '../model/types'
import { getWidgetReloadKey, retryWidget } from '../model/widget-frame-model'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'
import styles from './WidgetFrame.module.css'

export type WidgetFrameProps = {
  instanceId: string
  typeId: string
  mode: WidgetMode
  onRequestFullscreen?: () => void
  onRequestClose?: () => void
  onDelete?: () => void
}

export const WidgetFrame = reatomMemo<WidgetFrameProps>((props) => {
  const { instanceId, typeId, mode, onRequestFullscreen, onRequestClose, onDelete } = props
  const type = findWidgetType(typeId)
  const theme = resolvedTheme()
  const reloadKey = getWidgetReloadKey(instanceId)

  const LazyWidget = useMemo(() => {
    if (type instanceof Error) return null
    return lazy(type.loadComponent)
  }, [type, reloadKey])

  if (type instanceof Error) {
    return (
      <div className={styles.frame}>
        <div className={styles.errorCard}>
          <span className={styles.errorTile}>
            <AlertTriangle size={22} aria-hidden />
          </span>
          <div className={styles.errorTitle}>Виджет не отвечает</div>
          <div className={styles.errorText}>{type.message}</div>
          <Badge variant="outline" className={styles.errorBadge}>
            {type.name}
          </Badge>
          {onDelete && (
            <div className={styles.errorActions}>
              <button className={styles.delete} aria-label="Удалить" onClick={onDelete}>
                Удалить
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.frame} data-widget-surface>
      <WidgetErrorBoundary
        resetKey={reloadKey}
        onError={(error) => console.warn(`[widget ${instanceId}] render failed:`, error.message)}
        onRetry={wrap(() => retryWidget(instanceId))}
        onDelete={onDelete}
      >
        <Suspense fallback={<Skeleton className={styles.skeleton} />}>
          {LazyWidget && (
            <LazyWidget
              instanceId={instanceId}
              typeId={typeId}
              mode={mode}
              theme={theme}
              requestFullscreen={() => onRequestFullscreen?.()}
              requestClose={() => onRequestClose?.()}
              reportError={(error) => console.warn(`[widget ${instanceId}] error:`, error)}
            />
          )}
        </Suspense>
      </WidgetErrorBoundary>
    </div>
  )
}, 'WidgetFrame')
```

- [ ] **Step 7: Rewrite `WidgetFrame.module.css`**

Replace the file with (drops the old shimmer keyframes — `Skeleton` uses Tailwind `animate-pulse`; adds the warning-tinted error card tokens from the spec, local to this card):

```css
.frame {
  position: relative;
  width: 100%;
  height: 100%;
  container-type: inline-size;
  background: var(--card);
}

.skeleton {
  position: absolute;
  inset: 12px;
  height: auto;
}

.errorCard {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  text-align: center;
  background: var(--card);
  color: var(--foreground);
}

.errorTile {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: oklch(0.94 0.05 70);
  color: oklch(0.56 0.15 55);
}
:root[data-theme='dark'] .errorTile {
  background: oklch(0.34 0.06 70);
  color: oklch(0.82 0.13 70);
}

.errorTitle {
  font-weight: 600;
  font-size: 15px;
}
.errorText {
  font-size: 13px;
  color: var(--muted-foreground);
}

.errorBadge {
  font-family: var(--font-mono);
  color: oklch(0.5 0.16 35);
  background: oklch(0.95 0.04 45);
  border-color: oklch(0.88 0.06 50);
}

.errorActions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.retry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 15px;
  border: 0;
  border-radius: 9px;
  background: var(--primary);
  color: var(--primary-foreground);
  font-weight: 600;
  cursor: pointer;
}
.retry:focus-visible,
.delete:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.delete {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 15px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--card);
  color: var(--destructive);
  font-weight: 600;
  cursor: pointer;
}
.delete:hover {
  background: color-mix(in oklch, var(--destructive), transparent 90%);
}
```

- [ ] **Step 8: Run both tests to verify they pass**

Run:

```bash
pnpm --filter client exec vitest run src/widget-host/ui/WidgetErrorBoundary.test.tsx src/widget-host/ui/WidgetFrame.test.tsx
```

Expected: PASS (boundary 5 cases + frame 4 cases). Then:

```bash
pnpm --filter client typecheck
```

Expected: PASS (the mock `WidgetType` literal now includes `description`).

- [ ] **Step 9: Commit**

```bash
git add client/src/widget-host/ui/WidgetErrorBoundary.tsx client/src/widget-host/ui/WidgetErrorBoundary.test.tsx client/src/widget-host/ui/WidgetFrame.tsx client/src/widget-host/ui/WidgetFrame.module.css client/src/widget-host/ui/WidgetFrame.test.tsx
git commit -m "feat(client): restyle widget error and loading states with delete action"
```

---

## Task 8: Board (card chrome + dot-grid + delete wiring)

**Files:**

- Modify: `client/src/board/ui/Board.tsx`
- Modify: `client/src/board/ui/Board.module.css`
- Test: `client/src/board/ui/Board.test.tsx`

**Interfaces:**

- Consumes: `WidgetFrame` with `onDelete` (Task 7); `removeInstance`, `expandedInstanceId`, `layout`, `instances`, `updateLayout` (board-model); `isBoardInteracting` (board-interaction-model). Card header icon-buttons use `aria-label` `Развернуть` (fullscreen) and `Удалить` (remove). Board passes `onDelete={wrap(() => removeInstance(instance.id))}` to each `WidgetFrame`.

- [ ] **Step 1: Update the failing test**

Replace `client/src/board/ui/Board.test.tsx`:

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { WidgetComponent } from '../../widget-host/model/types'
import { findWidgetType } from '../../widget-registry/model/registry'
import { addInstance, instances, layout } from '../model/board-model'
import { Board } from './Board'

const registryHolder = vi.hoisted(() => ({
  actual:
    null as unknown as (typeof import('../../widget-registry/model/registry'))['findWidgetType'],
}))

vi.mock('../../widget-registry/model/registry', async (importActual) => {
  const actual = await importActual<typeof import('../../widget-registry/model/registry')>()
  registryHolder.actual = actual.findWidgetType
  return { ...actual, findWidgetType: vi.fn(actual.findWidgetType) }
})

const BrokenWidget = (() => {
  throw new Error('boom')
}) as WidgetComponent

beforeEach(() => {
  context.reset()
  localStorage.clear()
  vi.mocked(findWidgetType).mockImplementation(registryHolder.actual)
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
    fireEvent.click(within(card).getByRole('button', { name: 'Удалить' }))
    expect(instances()).toHaveLength(0)
  })

  it('removes an unknown widget via the error-card delete action', async () => {
    instances.set([{ id: 'missing-1', typeId: 'missing' }])
    layout.set([{ i: 'missing-1', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 }])

    render(<Board />)

    const card = await screen.findByTestId('widget-card')
    expect(within(card).getByText('Виджет не отвечает')).toBeInTheDocument()
    const deleteButtons = within(card).getAllByRole('button', { name: 'Удалить' })
    expect(deleteButtons).toHaveLength(2)
    const errorDeleteButton = deleteButtons[1]
    if (!errorDeleteButton) throw new Error('error delete button not found')

    fireEvent.click(errorDeleteButton)

    expect(instances()).toHaveLength(0)
    expect(layout()).toHaveLength(0)
  })

  it('removes a crashed widget via the error-boundary delete action', async () => {
    vi.mocked(findWidgetType).mockImplementation((typeId) => {
      if (typeId === 'boom') {
        return {
          id: 'boom',
          title: 'Сломанный виджет',
          description: 'Падает во время render',
          loadComponent: async () => ({ default: BrokenWidget }),
          defaultSize: { w: 3, h: 2 },
          icon: 'Clock',
        }
      }

      return registryHolder.actual(typeId)
    })

    const id = addInstance('boom')
    if (id instanceof Error) throw id

    render(<Board />)

    const card = await screen.findByTestId('widget-card')
    expect(await within(card).findByText('Виджет не отвечает')).toBeInTheDocument()
    const deleteButtons = within(card).getAllByRole('button', { name: 'Удалить' })
    const errorDeleteButton = deleteButtons.at(-1)
    if (!errorDeleteButton) throw new Error('error-boundary delete button not found')

    fireEvent.click(errorDeleteButton)

    expect(instances()).toHaveLength(0)
    expect(layout()).toHaveLength(0)
  })

  it('renders a stable drag handle for grid interactions', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    render(<Board />)
    const card = await screen.findByTestId('widget-card')
    const handle = within(card).getByText('Часы')
    expect(handle).toHaveClass('widget-drag-handle')
    expect(card.querySelector('iframe')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
pnpm --filter client exec vitest run src/board/ui/Board.test.tsx
```

Expected: FAIL — remove button label is `Remove`; drag handle text is `Clock`; unknown-widget fallback and runtime error-boundary fallback do not yet expose the Russian error-card delete path.

- [ ] **Step 3: Rewrite `Board.tsx`**

Only the card header labels and the new `onDelete` prop change vs. the current file; keep the grid config and interaction model wiring identical:

```tsx
import { wrap } from '@reatom/core'
import type { CSSProperties } from 'react'
import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout'
import { GripVertical, Maximize2, X } from 'lucide-react'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import { WidgetFrame } from '../../widget-host/ui/WidgetFrame'
import { findWidgetType } from '../../widget-registry/model/registry'
import {
  beginBoardInteraction,
  endBoardInteraction,
  isBoardInteracting,
} from '../model/board-interaction-model'
import {
  expandedInstanceId,
  instances,
  layout,
  removeInstance,
  updateLayout,
} from '../model/board-model'
import { EmptyState } from './EmptyState'
import styles from './Board.module.css'

export const Board = reatomMemo(() => {
  const currentInstances = instances()
  const currentLayout = layout()
  const isInteracting = isBoardInteracting()
  const { width, containerRef } = useContainerWidth()

  if (currentInstances.length === 0) {
    return (
      <div className={styles.root}>
        <EmptyState />
      </div>
    )
  }

  return (
    <div className={styles.root} data-interacting={isInteracting}>
      <div ref={containerRef}>
        <ReactGridLayout
          className="layout"
          width={width || 1200}
          layout={currentLayout}
          gridConfig={{ cols: 12, rowHeight: 30 }}
          dragConfig={{
            enabled: true,
            handle: '.widget-drag-handle',
            cancel: 'button,input,textarea,select,a,[data-widget-drag-cancel]',
          }}
          resizeConfig={{ enabled: true, handles: ['se'] }}
          compactor={verticalCompactor}
          onDragStart={wrap(() => beginBoardInteraction())}
          onDragStop={wrap(() => endBoardInteraction())}
          onResizeStart={wrap(() => beginBoardInteraction())}
          onResizeStop={wrap(() => endBoardInteraction())}
          onLayoutChange={wrap((next) => updateLayout([...next]))}
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
                        aria-label="Развернуть"
                        onClick={wrap(() => expandedInstanceId.set(instance.id))}
                      >
                        <Maximize2 size={15} aria-hidden />
                      </button>
                      <button
                        className={styles.iconButton}
                        aria-label="Удалить"
                        onClick={wrap(() => removeInstance(instance.id))}
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
                      onRequestFullscreen={wrap(() => expandedInstanceId.set(instance.id))}
                      onDelete={wrap(() => removeInstance(instance.id))}
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

- [ ] **Step 4: Rewrite `Board.module.css`**

Flat card chrome + dot-grid overlay while interacting + accent ring on the dragged/resizing card:

```css
.root {
  position: relative;
  min-height: 100%;
  padding: 20px;
}

.root[data-interacting='true']::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: radial-gradient(var(--dot-grid) 1.1px, transparent 1.1px);
  background-size: 32px 32px;
  opacity: 0.5;
}

.gridItem {
  height: 100%;
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  transition:
    box-shadow 0.2s var(--ease),
    border-color 0.2s var(--ease);
}

.gridItem:global(.react-draggable-dragging) .card,
.gridItem:global(.react-resizable-resizing) .card {
  border-color: var(--primary);
  box-shadow:
    0 0 0 3px var(--accent-soft),
    var(--shadow-card);
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
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
  user-select: none;
}
.handle:active {
  cursor: grabbing;
}
.grip {
  opacity: 0.6;
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
  border-radius: 8px;
  background: var(--secondary);
  color: var(--text-3);
  cursor: pointer;
  transition:
    color 0.15s var(--ease),
    background 0.15s var(--ease);
}
.iconButton:hover {
  color: var(--foreground);
  background: var(--muted);
}
.iconButton:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.gridItem :global(.react-resizable-handle-se) {
  right: 6px;
  bottom: 6px;
  width: 18px;
  height: 18px;
  background: none;
}
.gridItem :global(.react-resizable-handle-se)::after {
  content: '';
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 10px;
  height: 10px;
  border-right: 2px solid var(--primary);
  border-bottom: 2px solid var(--primary);
  border-radius: 0 0 4px 0;
}

.body {
  flex: 1;
  min-height: 0;
}
```

> Note: the card-rise entry animation is dropped (the `--i` style stays harmlessly unused; leave it for a future stagger). The `.react-draggable-dragging`/`.react-resizable-resizing` selectors are react-grid-layout's active-item classes; if a version renames them the ring simply won't show (non-breaking).

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
pnpm --filter client exec vitest run src/board/ui/Board.test.tsx
```

Expected: PASS (4 cases).

- [ ] **Step 6: Commit**

```bash
git add client/src/board/ui/Board.tsx client/src/board/ui/Board.module.css client/src/board/ui/Board.test.tsx
git commit -m "feat(client): restyle board cards, dot-grid interaction and delete wiring"
```

---

## Task 9: EmptyState / onboarding

**Files:**

- Modify: `client/src/board/ui/EmptyState.tsx`
- Modify: `client/src/board/ui/EmptyState.module.css`
- Create: `client/src/board/ui/EmptyState.test.tsx`
- Modify: `client/src/board/ui/Board.test.tsx` (integration empty-state assertion after the copy is translated)

**Interfaces:**

- Consumes: `openAddWidgetMenu` from `add-widget-menu-model`. Both the primary (`Добавить виджет`) and secondary (`Открыть каталог`) buttons call `openAddWidgetMenu()`.

- [ ] **Step 1: Write the failing test**

Create `client/src/board/ui/EmptyState.test.tsx`:

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { isAddWidgetMenuOpen } from '../model/add-widget-menu-model'
import { EmptyState } from './EmptyState'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('EmptyState', () => {
  it('renders the onboarding heading and both actions', () => {
    render(<EmptyState />)
    expect(screen.getByText('Начните с первого виджета')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить виджет' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть каталог' })).toBeInTheDocument()
  })

  it('opens the catalog from the primary action', () => {
    render(<EmptyState />)
    expect(isAddWidgetMenuOpen()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить виджет' }))
    expect(isAddWidgetMenuOpen()).toBe(true)
  })

  it('opens the catalog from the secondary action', () => {
    render(<EmptyState />)
    fireEvent.click(screen.getByRole('button', { name: 'Открыть каталог' }))
    expect(isAddWidgetMenuOpen()).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
pnpm --filter client exec vitest run src/board/ui/EmptyState.test.tsx
```

Expected: FAIL — current EmptyState has English copy and no action buttons.

- [ ] **Step 3: Rewrite `EmptyState.tsx`**

```tsx
import { wrap } from '@reatom/core'
import { Plus } from 'lucide-react'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import { openAddWidgetMenu } from '../model/add-widget-menu-model'
import styles from './EmptyState.module.css'

export const EmptyState = reatomMemo(() => {
  const open = wrap(() => openAddWidgetMenu())
  return (
    <div className={styles.empty}>
      <span className={styles.icon}>
        <Plus size={30} strokeWidth={2} aria-hidden />
      </span>
      <h2 className={styles.title}>Начните с первого виджета</h2>
      <p className={styles.hint}>
        Добавляйте виджеты из каталога, свободно перемещайте их и меняйте размер. Раскладка
        сохранится на этом устройстве.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={open}>
          <Plus size={16} strokeWidth={2.4} aria-hidden />
          Добавить виджет
        </button>
        <button type="button" className={styles.secondary} onClick={open}>
          Открыть каталог
        </button>
      </div>
    </div>
  )
}, 'EmptyState')
```

- [ ] **Step 4: Rewrite `EmptyState.module.css`**

```css
.empty {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 60vh;
  text-align: center;
  color: var(--muted-foreground);
}
.empty::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: radial-gradient(var(--dot-grid) 1.1px, transparent 1.1px);
  background-size: 32px 32px;
  opacity: 0.4;
  mask-image: radial-gradient(closest-side, #000 60%, transparent);
}

.icon {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  border-radius: 18px;
  background: var(--accent-soft);
  color: var(--primary);
}

.title {
  margin: 6px 0 0;
  font-weight: 600;
  font-size: 22px;
  letter-spacing: -0.01em;
  color: var(--foreground);
}

.hint {
  margin: 0;
  max-width: 400px;
  font-size: 15px;
  line-height: 1.55;
  color: var(--muted-foreground);
  text-wrap: pretty;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.primary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 42px;
  padding: 0 18px;
  border: 0;
  border-radius: 11px;
  background: var(--primary);
  color: var(--primary-foreground);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  box-shadow: var(--shadow-card);
}

.secondary {
  display: inline-flex;
  align-items: center;
  height: 42px;
  padding: 0 18px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card);
  color: var(--foreground);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
}

.primary:focus-visible,
.secondary:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
pnpm --filter client exec vitest run src/board/ui/EmptyState.test.tsx
```

Expected: PASS (3 cases).

- [ ] **Step 6: Update the Board empty-state assertion**

Now that `EmptyState` has Russian copy, update the empty-board case in `client/src/board/ui/Board.test.tsx`:

```tsx
it('shows the empty state when there are no widgets', () => {
  render(<Board />)
  expect(screen.getByText('Начните с первого виджета')).toBeInTheDocument()
})
```

Run:

```bash
pnpm --filter client exec vitest run src/board/ui/Board.test.tsx src/board/ui/EmptyState.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/board/ui/EmptyState.tsx client/src/board/ui/EmptyState.module.css client/src/board/ui/EmptyState.test.tsx client/src/board/ui/Board.test.tsx
git commit -m "feat(client): rebuild empty state with dot-grid onboarding and catalog actions"
```

---

## Task 10: FullscreenOverlay (Dialog)

**Files:**

- Modify: `client/src/widget-host/ui/FullscreenOverlay.tsx`
- Modify: `client/src/widget-host/ui/FullscreenOverlay.module.css`
- Test: `client/src/widget-host/ui/FullscreenOverlay.test.tsx`

**Interfaces:**

- Consumes: `Dialog`, `DialogContent`, `DialogTitle` (Task 2); `Badge` (Task 2); `WidgetFrame` (Task 7); `expandedInstanceId`, `instances`, `removeInstance` (board-model); `findWidgetType` (registry, with `description`). Driven by `expandedInstanceId`: Dialog `open` when an instance is expanded; `onOpenChange(false)` sets it to `null` (preserves Escape + focus trap via Radix). Close button `aria-label` = `Закрыть`; size `Badge` text = `large`; header shows icon tile + title (`DialogTitle`) + badge + subtitle (`description`).

- [ ] **Step 1: Update the failing test**

Replace `client/src/widget-host/ui/FullscreenOverlay.test.tsx`:

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { addInstance, expandedInstanceId } from '../../board/model/board-model'
import { FullscreenOverlay } from './FullscreenOverlay'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('FullscreenOverlay', () => {
  it('renders nothing when no instance is expanded', () => {
    const { container } = render(<FullscreenOverlay />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders a large frame for the expanded instance and closes via the close button', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByText(/:/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(expandedInstanceId()).toBeNull()
  })

  it('closes on Escape', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(expandedInstanceId()).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
pnpm --filter client exec vitest run src/widget-host/ui/FullscreenOverlay.test.tsx
```

Expected: FAIL — current close label is `Close`, not `Закрыть` (and the hand-rolled backdrop differs from the Dialog markup).

- [ ] **Step 3: Rewrite `FullscreenOverlay.tsx`**

```tsx
import { wrap } from '@reatom/core'
import { CalendarDays, Clock, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { expandedInstanceId, instances, removeInstance } from '../../board/model/board-model'
import { reatomMemo } from '../../shared/reatom/reatom-memo'
import { findWidgetType, type WidgetIconName } from '../../widget-registry/model/registry'
import { WidgetFrame } from './WidgetFrame'
import styles from './FullscreenOverlay.module.css'

const WIDGET_ICONS: Record<WidgetIconName, LucideIcon> = { Clock, CalendarDays }

export const FullscreenOverlay = reatomMemo(() => {
  const id = expandedInstanceId()
  if (id === null) return null

  const instance = instances().find((item) => item.id === id)
  if (!instance) return null

  const type = findWidgetType(instance.typeId)
  const title = type instanceof Error ? instance.typeId : type.title
  const description = type instanceof Error ? '' : type.description
  const Icon = type instanceof Error ? null : WIDGET_ICONS[type.icon]
  const close = wrap(() => expandedInstanceId.set(null))

  return (
    <Dialog
      open
      onOpenChange={wrap((next: boolean) => {
        if (!next) close()
      })}
    >
      <DialogContent
        className={styles.panel}
        overlayClassName={styles.overlay}
        aria-describedby={undefined}
      >
        <div className={styles.bar}>
          <div className={styles.heading}>
            {Icon && (
              <span className={styles.tile}>
                <Icon size={18} aria-hidden />
              </span>
            )}
            <div className={styles.titleBlock}>
              <div className={styles.titleRow}>
                <DialogTitle className={styles.title}>{title}</DialogTitle>
                <Badge variant="secondary" className={styles.badge}>
                  large
                </Badge>
              </div>
              {description && <div className={styles.subtitle}>{description}</div>}
            </div>
          </div>
          <button className={styles.close} aria-label="Закрыть" onClick={close}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className={styles.body}>
          <WidgetFrame
            instanceId={instance.id}
            typeId={instance.typeId}
            mode="large"
            onRequestClose={close}
            onDelete={wrap(() => removeInstance(instance.id))}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}, 'FullscreenOverlay')
```

- [ ] **Step 4: Rewrite `FullscreenOverlay.module.css`**

```css
.overlay {
  background: var(--scrim);
  backdrop-filter: blur(8px);
}

.panel {
  display: flex;
  flex-direction: column;
  width: min(900px, 92vw);
  height: min(680px, 88vh);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow: var(--shadow-overlay);
  overflow: hidden;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}

.heading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.tile {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 11px;
  background: var(--accent-soft);
  color: var(--primary);
}

.titleBlock {
  min-width: 0;
}
.titleRow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.title {
  font-weight: 600;
  font-size: 17px;
  color: var(--foreground);
}
.badge {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
}
.subtitle {
  font-size: 13px;
  color: var(--muted-foreground);
}

.close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: none;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card);
  color: var(--text-3);
  cursor: pointer;
  transition:
    color 0.15s var(--ease),
    background 0.15s var(--ease);
}
.close:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.close:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.body {
  flex: 1;
  min-height: 0;
  padding: 16px;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
pnpm --filter client exec vitest run src/widget-host/ui/FullscreenOverlay.test.tsx
```

Expected: PASS (3 cases).

- [ ] **Step 6: Commit**

```bash
git add client/src/widget-host/ui/FullscreenOverlay.tsx client/src/widget-host/ui/FullscreenOverlay.module.css client/src/widget-host/ui/FullscreenOverlay.test.tsx
git commit -m "feat(client): move fullscreen overlay to shadcn Dialog with rich header"
```

---

## Task 11: E2E selectors + dark-token verification

**Files:**

- Modify: `client/e2e/pages/HeaderPage.ts`
- Modify: `client/e2e/pages/BoardPage.ts`
- Modify: `client/e2e/pages/OverlayPage.ts`
- Modify: `client/e2e/widget-interactions.spec.ts`

**Interfaces:**

- Consumes: all Russian copy from the Global Constraints map. Adds a Playwright assertion that the dark palette actually applies (the real check the jsdom tests can't do).

- [ ] **Step 1: Update `HeaderPage.ts`**

```ts
import type { Locator, Page } from '@playwright/test'

export class HeaderPage {
  readonly addWidgetButton: Locator
  readonly themeToggle: Locator

  constructor(readonly page: Page) {
    const header = page.getByRole('banner')
    this.addWidgetButton = header.getByRole('button', { name: 'Добавить виджет' })
    this.themeToggle = header.getByRole('group', { name: 'Тема' })
  }

  async addWidget(title: string): Promise<void> {
    await this.addWidgetButton.click()
    await this.page.getByRole('button', { name: `Добавить: ${title}` }).click()
  }

  async setTheme(mode: 'Светлая тема' | 'Тёмная тема' | 'Системная тема'): Promise<void> {
    await this.themeToggle.getByRole('button', { name: mode }).click()
  }
}
```

- [ ] **Step 2: Update `BoardPage.ts`**

```ts
import type { Locator, Page } from '@playwright/test'

export class BoardPage {
  readonly widgetCards: Locator
  readonly emptyState: Locator

  constructor(readonly page: Page) {
    this.widgetCards = page.locator('[data-testid="widget-card"]')
    this.emptyState = page.getByRole('heading', { name: 'Начните с первого виджета' })
  }

  getCard(index: number): Locator {
    return this.widgetCards.nth(index)
  }

  async expandCard(index: number): Promise<void> {
    await this.getCard(index).getByRole('button', { name: 'Развернуть' }).click()
  }

  async removeCard(index: number): Promise<void> {
    await this.getCard(index).getByRole('button', { name: 'Удалить' }).click()
  }
}
```

- [ ] **Step 3: Update `OverlayPage.ts`**

```ts
import type { Locator, Page } from '@playwright/test'

export class OverlayPage {
  readonly dialog: Locator
  readonly closeButton: Locator

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog')
    this.closeButton = this.dialog.getByRole('button', { name: 'Закрыть' })
  }

  async waitForOpen(): Promise<void> {
    await this.dialog.waitFor({ state: 'visible' })
  }

  async close(): Promise<void> {
    await this.closeButton.click()
  }

  async pressEscape(): Promise<void> {
    await this.page.keyboard.press('Escape')
  }
}
```

- [ ] **Step 4: Update `widget-interactions.spec.ts`**

Apply these string swaps (logic unchanged):

- `seedClockWidget`: `await header.addWidget('Clock')` → `await header.addWidget('Часы')`.
- Theme test: `header.setTheme('Dark')` → `header.setTheme('Тёмная тема')`; the two `getByRole('button', { name: 'Dark' })` → `{ name: 'Тёмная тема' }`; `header.setTheme('Light')` → `'Светлая тема'`; `{ name: 'Light' }` → `{ name: 'Светлая тема' }`.
- Expand test: `getByRole('button', { name: 'Expand' })` → `{ name: 'Развернуть' }`; `getByRole('button', { name: 'Close' })` → `{ name: 'Закрыть' }`.

Then append a dark-token verification test (the assertion jsdom can't make — proves the `data-theme` dark variant + palette actually apply in a real browser):

```ts
test('dark theme applies the dark background token', async ({ page }) => {
  await page.goto('/')
  const header = new HeaderPage(page)

  await header.setTheme('Светлая тема')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  await header.setTheme('Тёмная тема')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  expect(dark).not.toBe(light)
})
```

- [ ] **Step 5: Typecheck and run the e2e suite**

Run:

```bash
pnpm --filter client typecheck:e2e
pnpm --filter client test:e2e
```

Expected: PASS (e2e TypeScript helpers compile; theme switch, expand-without-duplicate-controls, skeleton, resize, drag, and the new dark-token test pass). If the dev/preview server is required, Playwright's `webServer` config starts it automatically; otherwise start `pnpm --filter client dev` first.

- [ ] **Step 6: Commit**

```bash
git add client/e2e
git commit -m "test(client): update e2e selectors for Russian copy and verify dark tokens"
```

---

## Task 12: Full-suite gate + screenshots

**Files:** none (verification only).

- [ ] **Step 1: Run the complete workspace test suite**

Run:

```bash
pnpm test
```

Expected: PASS — workspace unit suites green (registry, models, every component, primitives smoke test, and server/package tests if present).

- [ ] **Step 2: Typecheck the workspace**

Run:

```bash
pnpm typecheck
```

Expected: PASS (client + node configs).

- [ ] **Step 3: Typecheck e2e**

Run:

```bash
pnpm --filter client typecheck:e2e
```

Expected: PASS.

- [ ] **Step 4: Run e2e**

Run:

```bash
pnpm test:e2e
```

Expected: PASS.

- [ ] **Step 5: Capture after screenshots**

Boot `pnpm dev`, use the same screenshot method as Task 0 (`1440x1000`, device scale factor `1`, locale `ru-RU`, timezone `Europe/Warsaw`, `page.clock.setFixedTime('2026-06-18T12:00:00+02:00')` before navigation, `page.screenshot({ path, fullPage: true })`), and save into `docs/superpowers/artifacts/2026-06-18-myboard-design-update/after/`. Use the same `boardSnapshot` and `errorSnapshot` shapes from Task 0.

- `empty-light.png`: theme `light`, no board snapshot.
- `empty-dark.png`: theme `dark`, no board snapshot.
- `board-light.png`: theme `light`, `boardSnapshot` (renders Часы + Лоток Офелии).
- `board-dark.png`: theme `dark`, `boardSnapshot`.
- `catalog-light.png`: theme `light`, no board snapshot, reload, click the header trigger with `page.getByRole('banner').getByRole('button', { name: 'Добавить виджет' })`, capture the open Popover.
- `overlay-light.png`: theme `light`, `boardSnapshot`, reload, click the first card's `Развернуть` button, capture the Dialog.
- `error-light.png`: theme `light`, `errorSnapshot`, reload, capture the unknown-widget error card.

Compare these with the Task 0 `before/` screenshots or `before/notes.md`, and attach both sets to the PR (UI change requirement from AGENTS.md / spec §9).

- [ ] **Step 6: Final commit (if any verification fixups were needed) and PR**

Open the PR summarizing scope, listing the verification commands above, and including the before/after screenshots.

---

## Self-Review (performed against the spec)

**Spec coverage** — every spec section maps to a task:

- §5.1 token mechanism (data-theme variant, semantic + app tokens, remove greyscale blocks) → Task 1. §5.2 palette → Task 1 (exact values transcribed). §5.3 shape/elevation (`--shadow-card`, `--shadow-overlay`, radii as literals, flat body) → Task 1 + per-component CSS. §5.4 typography (fontsource add/remove, `--font-sans`/`--font-mono`, mono usage) → Task 1 (deps/vars) + Tasks 6/8/10 (mono labels/badges).
- §6 primitives (popover, input, dialog, toggle-group, badge, separator, skeleton, all `reatomMemo`) → Task 2.
- §7.1 Header → Task 4. §7.2 ThemeToggle (ToggleGroup, VT preserved, aria-pressed) → Task 5. §7.3 Catalog (Popover, arrow, Input filter, count, rows, recommended first row, footer copy, registry description) → Tasks 3 + 6. §7.4 Board (card chrome, grip handle, hover actions, `se` accent corner glyph, dot-grid + accent ring on interaction, RGL config kept) → Task 8. §7.5 EmptyState → Task 9. §7.6 FullscreenOverlay (Dialog) → Task 10. §7.7 widget states (error/unknown/loading, `onDelete` wiring) → Task 7 (+ Board wiring in Task 8, FullscreenOverlay wiring in Task 10). §7.8 global.css → Task 1.
- §8 accessibility (aria-pressed/labels, Dialog role/modal, popover aria, icon-button labels, ring+elevation not color-only) → Tasks 5/6/8/10 (explicit `aria-pressed`, `aria-label`s, focus-visible rings).
- §9 testing (update component tests for new markup/Russian copy; catalog filter; delete-from-error invokes `removeInstance` for unknown and runtime-boundary failures; theme flips data-theme; refresh Playwright; e2e typecheck; PR gate; before/after screenshots) → Tasks 0 and 3–12.
- §10 risks: dark-variant swap verified in Task 11 (real-browser token check); `--accent` vs brand handled by the token rule + `--accent-soft`; iframe-copy avoided (footer copy is "работает изолированно"); font load order (add new fonts before removing old in Task 1 Step 1, CSS imports swapped same task); untouched widget internals keep working via Task 1 compatibility aliases (`--surface`, `--text`, `--text-dim`, `--font-ui`, `--font-display`, `--accent-2`); Ofelia avatar palette left to the widget (untouched).
- §11 file change map → File Structure section matches exactly. §12 out-of-scope (adaptive tiers, demo widget, rich Ofelia, edit mode, Frame-07 panel) → not planned, as required.

**Placeholder scan:** no TBD/"handle edge cases"/"similar to Task N"/"write tests for the above" — every code and test step carries full content.

**Type consistency:** `WidgetType.description` (Task 3) is consumed by `filteredWidgetTypes` (Task 6), catalog rows (Task 6), overlay subtitle (Task 10), and the WidgetFrame mock updated in Task 3 so typecheck stays green. `WidgetFrameProps.onDelete?` (Task 7) is what Board passes (Task 8) and FullscreenOverlay passes (Task 10). `WidgetErrorBoundary` `onDelete?` prop (Task 7) matches its own usage. `catalogQuery`/`filteredWidgetTypes`/`closeAddWidgetMenu` (Task 6 model) match the AddWidgetMenu imports. Primitive export names (Task 2) match every later import (`Input`, `Badge`, `Popover`/`PopoverTrigger`/`PopoverContent`/`PopoverArrow`, `Dialog`/`DialogContent`/`DialogTitle`, `ToggleGroup`/`ToggleGroupItem`, `Skeleton`). Russian strings are identical between component tasks and the e2e task via the Global Constraints map.
