# Activation screens: adopt shadcn primitives

## Context

`packages/client/activation` is a standalone Vite app (separate from the
board's federation graph) serving `/activate/*`. It already imports the
board's shared Tailwind/shadcn token layer (`@import 'shadcn/tailwind.css'`
in `activation/src/global.css`, plus the `@` alias to `packages/client/src`
for the theme model), but `ActivateScreen.tsx`, `AddDeviceScreen.tsx`, and
`ThemeTogglePill.tsx` implement every interactive control (buttons, text
inputs, the theme-toggle segmented control) as raw HTML elements styled by
hand-written CSS modules, reproducing a pixel-precise `.dc.html` design spec
rather than reusing `packages/client/src/components/ui/*`.

The user is fine dropping pixel-perfect fidelity to that spec in favor of
reusing the shared shadcn components (`Button`, `Input`, `ToggleGroup`).

## Decisions

1. **Adopt shadcn's default look, not just its markup.** Colors, hover,
   focus-visible ring, and `aria-invalid` error styling come from the shadcn
   component defaults. Custom CSS module rules that only re-implement what
   the shadcn component already does (hover-darken, disabled opacity,
   focus ring, error ring) are deleted rather than layered on top.
2. **Preserve current sizing via className overrides.** The screens' 48px
   control height and 13px border radius are kept (visually the biggest
   scale cue on these screens) by appending a small override class after the
   shadcn base classes, e.g. `className={cn(styles.ctaSize)}` passed through
   to `Button`/`Input`.
3. **Scope: interactive elements only.** `.page`, `.card`, the brand mark,
   the `stepIn` step-transition animation, and the free-standing error rows
   (`.serverError`, `.fieldError`, `.codeErrorRow` — icon + text, no shadcn
   equivalent exists in `components/ui`) are unchanged.

## Component mapping

### `ActivateScreen.tsx`

- Name field → `Input` (`@/components/ui/input`). Drop the module's manual
  `:focus-visible` / `.inputError` rules — `Input`'s own
  `aria-invalid:border-destructive aria-invalid:ring-destructive/20` covers
  it, and the component already sets `aria-invalid={hasNameError}`. Keep a
  size-override class for height/radius/padding/font-size.
- CTA button (`Создать ключ доступа` / `Войти с ключом доступа`) → `Button`
  (`variant="default"`), same size-override class. Drop the module's manual
  `:hover` / `:disabled` rules.

### `AddDeviceScreen.tsx`

- The three CTA buttons (`Сканировать QR-код`, `Создать passkey`, the
  `manual`-mode `Продолжить`) → `Button` (`variant="default"`), same
  size-override class.
- `Продолжить` (choose screen) and `Попробовать снова` (rejected screen) →
  `Button` (`variant="outline"`).
- `Ввести код вручную` (camera-denied fallback) → `Button` (`variant="link"`).
  This trades the current color-shift-on-hover for shadcn's
  underline-on-hover — an accepted non-pixel-perfect deviation.
- Both code inputs (choose screen's quick field, manual screen's field) →
  `Input`, with an override class for the mono font, uppercase
  letter-spacing, centered text, and the shared 48px/13px sizing. This
  override class stays large since the mono/centered look is
  content-specific, not something `Input`'s defaults provide.

### `ThemeTogglePill.tsx`

- The manual `role="group"` + three `<button data-state>` → `ToggleGroup`
  (`type="single"`, `value`/`onValueChange`) + `ToggleGroupItem` per option.
  `onValueChange` must guard against Radix's empty-string deselect event
  (`(v) => v && setMode(v as ThemeMode)}`) since this is a controlled 3-way
  switcher, not a toggleable set. Existing `.themeToggle` /
  `.themeToggleItem[data-state='on']` CSS carries over almost unchanged —
  this control is close to what `ToggleGroup` is built for.

## Testing impact

`AddDeviceScreen.test.tsx` and the e2e page object
(`e2e/pages/AddDeviceActivatePage.ts`) query by role/label/text
(`getByLabelText`, `getByRole('button', { name })`, `getByRole('alert')`),
not by CSS class or DOM shape, so they should not need changes as long as
labels, `type="button"`, and visible text are preserved through the swap.

## Out of scope

- No changes to `activation-model.ts` / `add-device-model.ts` (business
  logic untouched).
- No changes to `.page`/`.card` shell, brand mark, or the `stepIn`
  animation.
- No new shadcn primitives beyond `Button`, `Input`, `ToggleGroup` (all
  already exist in `packages/client/src/components/ui`).
