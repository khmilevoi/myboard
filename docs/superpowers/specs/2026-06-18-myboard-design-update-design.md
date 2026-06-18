# myboard — Design Update (Shell + Design System)

- **Date:** 2026-06-18
- **Status:** Approved (brainstorming) → ready for implementation plan
- **Source design:** [`2026-06-18-myboard-design-update-mockup.html`](./2026-06-18-myboard-design-update-mockup.html) (Claude design artifact, self-extracting standalone; 9 frames across Light / Dark / States / Adaptive-tiers sections)
- **Scope decision:** Shell + design system only. Adaptive tiers, rich widget content, and the demo widget are explicit follow-ups.

## 1. Summary

Reskin the myboard host shell to match the supplied mockup: a cool, flat, violet-accented design built on **Hanken Grotesk + JetBrains Mono**, replacing the current warm neumorphic theme and the half-installed shadcn greyscale defaults. The mockup's light/dark palettes become the single source of truth, wired into shadcn's semantic tokens so shadcn primitives and bespoke CSS Modules share one variable set. Standard UI is built from shadcn primitives styled with Tailwind utilities; bespoke layout (board grid, widget card chrome, catalog rows, dot-grid) stays in CSS Modules reading the shared tokens.

Widget *internals* (Clock, Ofelia) and the `WidgetMode = 'small' | 'large'` contract are unchanged.

## 2. Current state (gap analysis)

- **Three competing token systems:**
  1. Legacy neumorphic `client/src/shared/theme/tokens.css` — cream/terracotta, Fraunces + Nunito, raised/pressed neumorphic shadows.
  2. shadcn defaults in `client/src/app/global.css` — greyscale `oklch` palette, Geist font.
  3. The target mockup — flat surfaces (`oklch` hue 255–262), violet accent (`oklch(0.55 0.17 281)`), dot-grid board, subtle flat shadows.
- **Dark mode is broken:** `theme-model.ts` applies the theme as `<html data-theme="light|dark">`, but `global.css` keys shadcn dark tokens off a `.dark` class (`@custom-variant dark (&:is(.dark *))`). The `.dark` class is never added, so shadcn's dark palette never activates. **Reconciling this is in scope.**
- **Components** are CSS Modules + `reatomMemo`; only `components/ui/button.tsx` is a real shadcn primitive. shadcn is configured (`components.json`: style `radix-nova`, baseColor `neutral`, css `src/app/global.css`).
- **Widgets:** `clock` and `ofelia-poop-duty` exist (`client/widgets/...`). The mockup's "Лоток Офелии" = existing `ofelia-poop-duty`. The mockup's "Демо-виджет" does **not** exist.
- **Registry** (`widget-registry/model/registry.ts`) has `id, title, loadComponent, defaultSize, icon` — **no `description`** (needed for catalog rows).

## 3. Goals / Non-goals

**Goals**
- One semantic token layer (light + dark) matching the mockup, driving both shadcn primitives and bespoke CSS.
- Fix dark-mode wiring so `data-theme` is the single mechanism.
- Restyle all host/chrome surfaces to mockup fidelity: topbar, theme toggle, catalog, board cards + interaction affordances, onboarding, fullscreen overlay, widget error/loading states.
- Introduce the agreed shadcn primitives with custom styling.

**Non-goals (follow-up specs)**
- 4-tier adaptive widget system (`tiny/compact/standard/large`) and any `WidgetMode` contract change.
- The "Демо-виджет".
- Richer Ofelia fullscreen content (week schedule / history / debt balance) beyond what the widget already renders.
- An explicit "edit mode" toggle/state machine.
- The standalone Frame-07 theme-settings panel (the topbar segmented toggle remains the only theme control).

## 4. Resolved decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | Shell + design system |
| 2 | Styling convention | Hybrid: shadcn primitives + Tailwind utilities for standard UI; CSS Modules for bespoke layout |
| 3 | Legacy themes | Replace entirely (delete neumorphic palette + greyscale shadcn defaults) |
| 4 | Token naming | Single layer keyed to shadcn semantic names + a small app-specific set; keyed to `data-theme` |
| 5 | UI copy language | **Russian**, matching the mockup |
| 6 | Fullscreen overlay | shadcn **`Dialog`** (focus trap + scrim for free) |
| 7 | Catalog search | plain **`Input`** + client-side filter (not `Command`) |

## 5. Design system

### 5.1 Token mechanism

- Rewrite `client/src/shared/theme/tokens.css` to define the palette under `:root, :root[data-theme='light']` and `:root[data-theme='dark']`.
- In `client/src/app/global.css`, change the dark variant to track `data-theme`:
  `@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));`
  and define the shadcn semantic variables (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--muted`, `--border`, `--ring`, …) from the palette below. Remove the greyscale `:root {…}` / `.dark {…}` default blocks.
- shadcn semantic tokens are the canonical names. App-specific tokens that shadcn lacks are added alongside: `--board`, `--border-strong`, `--text-3`, `--accent-soft`, `--scrim`, `--shadow-card`, `--success`, `--dot-grid`.

### 5.2 Palette (exact values from the mockup)

| shadcn / app token | Light | Dark |
|---|---|---|
| `--background` | `oklch(0.975 0.003 255)` | `oklch(0.19 0.008 262)` |
| `--board` | `oklch(0.96 0.004 255)` | `oklch(0.165 0.008 262)` |
| `--card`, `--popover` | `oklch(1 0 0)` | `oklch(0.225 0.01 262)` |
| `--secondary`, `--muted` (`surface-2`) | `oklch(0.972 0.004 255)` | `oklch(0.26 0.012 262)` |
| `--border`, `--input` | `oklch(0.91 0.005 255)` | `oklch(0.3 0.012 262)` |
| `--border-strong` | `oklch(0.84 0.006 255)` | `oklch(0.36 0.014 262)` |
| `--foreground`, `--card-foreground`, `--popover-foreground` | `oklch(0.27 0.02 262)` | `oklch(0.95 0.005 262)` |
| `--muted-foreground`, `--secondary-foreground` (`text-2`) | `oklch(0.5 0.018 262)` | `oklch(0.72 0.012 262)` |
| `--text-3` (faint labels) | `oklch(0.66 0.012 262)` | `oklch(0.55 0.012 262)` |
| `--primary`, `--ring` | `oklch(0.55 0.17 281)` | `oklch(0.68 0.15 285)` |
| `--accent-soft` (selected tint) | `oklch(0.955 0.032 285)` | `oklch(0.32 0.07 285)` |
| `--primary-foreground` (`on-accent`) | `#ffffff` | `oklch(0.18 0.03 285)` |
| `--scrim` | `oklch(0.45 0.02 262 / 0.34)` | `oklch(0.1 0.01 262 / 0.62)` |
| `--success` (online dot) | `oklch(0.7 0.16 150)` | `oklch(0.72 0.16 150)` |
| `--destructive` (keep for delete/error) | shadcn red kept, re-tuned if needed | — |

Notes:
- shadcn's own `--accent` token (a muted *hover* background, distinct from the brand) maps to `--secondary`/`--muted`; the brand violet is `--primary`. Do not conflate them.
- `--dot-grid` = `--border-strong`; rendered via `radial-gradient(var(--dot-grid) 1.1px, transparent 1.1px)` at `~32px` spacing, low opacity.

### 5.3 Shape & elevation

- `--shadow-card`: light `0 1px 2px rgba(20,22,40,.05), 0 2px 8px rgba(20,22,40,.05)`; dark `0 1px 2px rgba(0,0,0,.3), 0 2px 10px rgba(0,0,0,.35)`.
- Frame/overlay shadow (heavier): light `0 24px 50px -18px rgba(30,32,55,.22)`; dark `0 24px 70px rgba(0,0,0,.55)`.
- Radii: cards `14px`, controls/buttons `8–11px`, overlay panel `18px`, pills `999px`. Keep shadcn `--radius` ≈ `0.625rem`; express bespoke radii as literals or app tokens.
- Body background is **flat** `--background` (remove the radial `--bg-grad` and all neumorphic raised/pressed shadows).

### 5.4 Typography

- Add deps `@fontsource-variable/hanken-grotesk`, `@fontsource-variable/jetbrains-mono`; import in `global.css`.
- `--font-sans` → `'Hanken Grotesk Variable', system-ui, sans-serif`; `--font-mono` → `'JetBrains Mono Variable', ui-monospace, monospace`.
- Remove Fraunces / Nunito / Geist imports from `tokens.css`/`global.css` and drop the deps from `client/package.json`.
- Mono usage: clock digits, uppercase micro-labels (letter-spaced), badges, timestamps/codes.

## 6. shadcn primitives to add

Via `pnpm dlx shadcn@latest add` (or manual, matching the existing `button.tsx` `reatomMemo` wrapper pattern): `popover`, `input`, `dialog`, `toggle-group`, `badge`, `separator`, `skeleton`. All exported components must follow AGENTS.md: defined with `reatomMemo` from `@/shared/reatom/reatom-memo`. Bespoke layout remains CSS Modules.

## 7. Component specifications

For each: keep `reatomMemo` + `ui/`/`model/` split; keep existing model atoms/actions unless noted.

### 7.1 Header / topbar — `app/ui/Header.tsx` (+ `.module.css`)
- 54px row, `--card` background, 1px bottom border.
- Two-tone text logo: `<span text-3>my</span><span text>board</span>` (remove the `LayoutGrid` icon).
- Right cluster: segmented `ThemeToggle` then the primary "Добавить виджет" button (plus icon, `--primary`, `--shadow-card`).

### 7.2 ThemeToggle — `theme/ui/ThemeToggle.tsx` (+ `.module.css`)
- Render as shadcn `ToggleGroup` (single-select) inside a bordered pill on `--background`.
- Three icon options: Sun (light) / Moon (dark) / Monitor (system). Active item = `--card` chip + `--shadow-card` + `--foreground`; inactive = `--text-3`.
- Preserve the existing View-Transition circular reveal (`--vt-x/--vt-y`, `startViewTransition`) and `aria-pressed`/labels.

### 7.3 Catalog (AddWidgetMenu) — `board/ui/AddWidgetMenu.tsx` (+ `.module.css`)
- shadcn `Popover` anchored to the "Добавить виджет" trigger, with arrow, on `--popover` with the frame/overlay shadow.
- Contents: header ("Каталог виджетов" + close), search `Input` ("Поиск виджетов") filtering client-side by title/description, a mono uppercase "Доступные · N" count, then widget rows.
- **Row** = icon tile + title + description + add (`Plus`) button. The first/recommended row uses the accent ring (`1.5px var(--primary)`) + `--accent-soft` background.
- Footer note restyled with a lock icon; copy softened to "Каждый виджет работает изолированно" (architecture is lazy React + error boundary, **not** literal iframes).
- Reuse existing `add-widget-menu-model` (open/close) and `addInstance`.
- **Registry change:** add `description: string` to `WidgetType`; populate (`clock` → "Текущее время и дата", `ofelia-poop-duty` → "Чья сегодня очередь убирать"). Titles follow the mockup ("Часы"; "Лоток Офелии" — display copy only, id unchanged).

### 7.4 Board — `board/ui/Board.tsx` (+ `Board.module.css`)
- Card: `--card` surface, `14px` radius, 1px `--border`, `--shadow-card`.
- Card header: grip drag-handle (`.widget-drag-handle`) + title; fullscreen + close icon-buttons revealed on hover/focus-within.
- `se` resize handle styled with an accent corner glyph.
- Interaction state (existing `data-interacting` from `board-interaction-model`): show the dot-grid overlay over the board; the dragged/active card gets the accent selection ring + `--accent-soft` glow.
- Keep react-grid-layout config (12 cols, rowHeight 30, `se` resize, drag handle/cancel).

### 7.5 EmptyState / onboarding — `board/ui/EmptyState.tsx` (+ `.module.css`)
- Dot-grid background; centered `--accent-soft` plus-icon tile; heading "Начните с первого виджета"; description; primary "Добавить виджет" + secondary "Открыть каталог".
- Both buttons call `openAddWidgetMenu()`. (Requires the empty state to reach the catalog model — wire via the existing model action.)

### 7.6 FullscreenOverlay — `widget-host/ui/FullscreenOverlay.tsx` (+ `.module.css`)
- Replace the hand-rolled backdrop with shadcn `Dialog` (scrim `--scrim` + blur, focus trap, Escape-to-close — preserves current keyboard/focus behavior, driven by `expandedInstanceId`).
- Panel: `--card`, `18px` radius, header = icon tile + title + "large" `Badge` + subtitle + close button. Body renders `<WidgetFrame mode="large">` (widget content unchanged).

### 7.7 Widget states — `widget-host/ui/WidgetFrame.tsx`, `WidgetErrorBoundary.tsx` (+ `WidgetFrame.module.css`)
- **Error/broken:** warning icon tile (literals from the mockup — light `oklch(0.94 0.05 70)` bg / `oklch(0.56 0.15 55)` fg; dark equivalents), title "Виджет не отвечает", subtext, the tagged-error name as a mono `Badge` (warning tint: fg `oklch(0.5 0.16 35)`, bg `oklch(0.95 0.04 45)`, border `oklch(0.88 0.06 50)`), then "Повторить" (primary → `retryWidget`) + "Удалить" (destructive → `removeInstance`). These warning colors are local to the error card, not added to the global token layer.
  - **New wiring:** add an `onDelete` prop to `WidgetFrame` / error boundary fallback; Board passes `() => removeInstance(instance.id)`.
- **Unknown widget type:** same restyled card, no retry.
- **Loading:** styled shadcn `Skeleton` in place of the bare skeleton div.

### 7.8 Global — `app/global.css`
- Flat body background; keep the react-grid placeholder rule (uses `--primary`) and the theme-reveal `@keyframes`; keep `prefers-reduced-motion` guard; keep `data-board-interacting` user-select/pointer rules.

## 8. Accessibility

- Maintain `aria-pressed`/labels on the theme toggle; `Dialog` provides `role="dialog"`/`aria-modal` + focus trap; popover trigger keeps `aria-haspopup`/`aria-expanded`; icon-only buttons keep `aria-label`. Selection/active states must not rely on color alone (ring + elevation).

## 9. Testing

- Update existing vitest component tests for new markup/Russian copy: `Header.test`, `Board.test`, `AddWidgetMenu.test`, `ThemeToggle.test`, `EmptyState` (add if missing), `FullscreenOverlay.test`, `WidgetFrame.test`.
- Add coverage: catalog client-side filtering; delete-from-error invokes `removeInstance`; theme toggle still flips `data-theme` and dark tokens resolve.
- Refresh affected Playwright selectors/strings in `client/e2e`.
- Gate: `pnpm test` + `pnpm typecheck` green before PR; `pnpm test:e2e` for board/theme flows. Include before/after screenshots in the PR (UI change).

## 10. Risks & caveats

- **Dark-mode selector swap** is load-bearing: every shadcn dark token depends on the `@custom-variant dark` change tracking `data-theme`. Verify after the token rewrite.
- **Token-name collision:** shadcn `--accent` (hover bg) vs. mockup "accent" (brand). Brand = `--primary`; keep `--accent-soft` separate.
- **Copy vs. architecture:** do not claim iframe isolation in the catalog footer; widgets are lazy React + error boundary.
- **Font swap** touches first paint; ensure `@fontsource` variable imports load before removing the old font deps.
- Avatar/status palettes used inside Ofelia (`oklch(0.86 0.07 25)` etc.) are widget-local content tokens — left to the widget, not added to the shell layer.

## 11. File change map

- **Rewrite:** `client/src/shared/theme/tokens.css`, `client/src/app/global.css` (token blocks + dark variant + fonts).
- **Add:** `client/src/components/ui/{popover,input,dialog,toggle-group,badge,separator,skeleton}.tsx`.
- **Edit (ui + module.css):** `app/ui/Header`, `theme/ui/ThemeToggle`, `board/ui/AddWidgetMenu`, `board/ui/Board`, `board/ui/EmptyState`, `widget-host/ui/FullscreenOverlay`, `widget-host/ui/WidgetFrame`, `widget-host/ui/WidgetErrorBoundary`.
- **Edit (model):** `widget-registry/model/registry.ts` (`description` field + Russian titles/descriptions).
- **Edit:** `client/package.json` (add Hanken Grotesk + JetBrains Mono fontsource; remove Fraunces/Nunito/Geist).
- **Edit:** affected `*.test.tsx` and `client/e2e/*`.

## 12. Out of scope → follow-up specs

1. 4-tier adaptive widget system (`tiny/compact/standard/large`) + `WidgetMode` contract change + per-tier Clock/Ofelia rendering.
2. Demo widget (host↔widget bridge check).
3. Rich Ofelia fullscreen content (week schedule, history, debt balance).
4. Explicit edit-mode toggle.
5. Standalone theme-settings panel (Frame 07).
