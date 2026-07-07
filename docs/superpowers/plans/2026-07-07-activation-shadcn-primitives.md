# Activation Screens: Adopt shadcn Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled `<button>`/`<input>`/segmented-control markup in `packages/client/activation`'s three UI files with the shared shadcn `Button`, `Input`, and `ToggleGroup`/`ToggleGroupItem` components from `packages/client/src/components/ui`.

**Architecture:** `packages/client/activation` already resolves the `@` alias to `packages/client/src` (see `vite.activation.config.ts` and `packages/client/tsconfig.json`'s `paths`) and already imports the shared Tailwind/shadcn token layer in `activation/src/global.css`. No new dependencies, no new alias wiring, no build config changes are needed — this is a pure component-swap inside three existing files (plus their CSS modules) and one new test file.

**Tech Stack:** React, shadcn primitives (`Button`, `Input`, `ToggleGroup`/`ToggleGroupItem`) from `@/components/ui/*`, Tailwind arbitrary-value utility classes (already used in this app, e.g. `className="animate-spin"` in `ActivateScreen.tsx`), Vitest + `@testing-library/react`.

## Global Constraints

- Colors, hover, focus-visible ring, and error-ring styling come from the shadcn component defaults — do not re-add custom `:hover`/`:disabled`/`:focus-visible`/error-border CSS for controls that are being swapped to `Button`/`Input`.
- Preserve current sizing: 48px control height and 13px border radius, via `className` overrides on top of the shadcn base classes (tailwind-merge in `widget-sdk/lib/utils`'s `cn()` — which `Button`/`Input` already call internally — makes a later `h-12`/`rounded-[13px]` in `className` win over the component's own `h-8`/`h-9`/`rounded-lg`/`rounded-md`).
- Scope is interactive elements only: `.page`, `.card`, the brand mark, the `stepIn` step-transition animation, and the icon+text error rows (`.serverError`, `.fieldError`, `.codeErrorRow`) are unchanged — no shadcn equivalent exists for the latter in `components/ui`.
- No changes to `activation-model.ts` or `add-device-model.ts` (business logic untouched).
- `AddDeviceScreen.test.tsx` and the e2e page object (`e2e/pages/AddDeviceActivatePage.ts`) query by role/label/text, not CSS class — they must keep passing unmodified.
- Reference implementation: `packages/client/src/theme/ui/ThemeToggle.tsx` and its test `ThemeToggle.test.tsx` already use `ToggleGroup`/`ToggleGroupItem` in this exact codebase — mirror that proven pattern for `ThemeTogglePill.tsx` rather than inventing a new one.

---

### Task 1: ActivateScreen — swap Input + Button to shadcn primitives

**Files:**
- Modify: `packages/client/activation/src/ui/ActivateScreen.tsx`
- Modify: `packages/client/activation/src/ui/ActivateScreen.module.css`

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button` (props: `variant?: 'default'|'outline'|'secondary'|'ghost'|'destructive'|'link'`, extends `React.ComponentProps<'button'>`), `Input` from `@/components/ui/input` (extends `React.ComponentProps<'input'>`).
- Produces: nothing new consumed by other tasks — `ActivateScreen.tsx` still renders `<ThemeTogglePill />` from Task 3 unchanged (same import, same call signature).

This file currently has no test file (`ActivateScreen.test.tsx` does not exist, and adding one is out of scope — `ActivateScreen` builds its model internally via `useState(() => createActivationModel())` with no dependency-injection point, unlike `AddDeviceScreen`). Verification for this task is typecheck plus the manual check in Task 4.

- [ ] **Step 1: Add the shadcn imports**

In `packages/client/activation/src/ui/ActivateScreen.tsx`, insert a new import group between the existing external-package imports and the `../model`/`./ThemeTogglePill` group (matching the `@/`-group convention already used in `ThemeTogglePill.tsx`), so the top of the file reads:

```tsx
import { bindField } from '@reatom/react'
import { AlertCircle, AlertTriangle, Fingerprint, Loader2, Lock } from 'lucide-react'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { createActivationModel } from '../model/activation-model'
import { ThemeTogglePill } from './ThemeTogglePill'

import styles from './ActivateScreen.module.css'
```

- [ ] **Step 2: Replace the name `<input>` with `Input`**

Replace:

```tsx
            <input
              type="text"
              placeholder="Ваше имя"
              aria-label="Ваше имя"
              aria-invalid={hasNameError}
              aria-describedby="activate-name-error"
              disabled={loading}
              className={`${styles.input} ${hasNameError ? styles.inputError : ''}`}
              onKeyDown={(event) => {
                if (event.key === 'Enter') model.startRegistration()
              }}
              {...bindField(nameField)}
            />
```

with:

```tsx
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
```

(`aria-invalid` already drives shadcn `Input`'s built-in destructive border/ring — the old `.inputError` class is no longer needed.)

- [ ] **Step 3: Replace the CTA `<button>` with `Button`**

Replace:

```tsx
        <button
          type="button"
          disabled={loading}
          onClick={() => (mode === 'new-account' ? model.startRegistration() : model.startLogin())}
          className={`${styles.primaryButton} ${mode === 'new-account' ? styles.primaryButtonAfterField : styles.primaryButtonStandalone}`}
        >
          {mode === 'new-account'
            ? passkeyButtonContent(loading, 'Создать ключ доступа', 'Создание ключа доступа…')
            : passkeyButtonContent(loading, 'Войти с ключом доступа', 'Вход…')}
        </button>
```

with:

```tsx
        <Button
          type="button"
          disabled={loading}
          onClick={() => (mode === 'new-account' ? model.startRegistration() : model.startLogin())}
          className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${mode === 'new-account' ? styles.primaryButtonAfterField : styles.primaryButtonStandalone}`}
        >
          {mode === 'new-account'
            ? passkeyButtonContent(loading, 'Создать ключ доступа', 'Создание ключа доступа…')
            : passkeyButtonContent(loading, 'Войти с ключом доступа', 'Вход…')}
        </Button>
```

- [ ] **Step 4: Trim `ActivateScreen.module.css`**

Delete these now-redundant rules (covered by `Input`/`Button` defaults): `.input`, `.input::placeholder`, `.input:disabled`, `.input:focus-visible`, `.input.inputError`, `.input.inputError:focus-visible`, `.primaryButton`, `.primaryButton:hover:not(:disabled)`, `.primaryButton:disabled`.

Keep `.primaryButtonAfterField` and `.primaryButtonStandalone` as-is (margin-top-only rules, still referenced from Step 3) and every other rule in the file (`.page`, `.card`, `.brandMark*`, `.brandLabel`, `.heading`, `.description*`, `.fieldGroup`, `.fieldError*`, `.serverError*`, `.footerNote`, `.themeToggle*`).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter client exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/client/activation/src/ui/ActivateScreen.tsx packages/client/activation/src/ui/ActivateScreen.module.css
git commit -m "refactor(activation): use shadcn Button/Input in ActivateScreen"
```

---

### Task 2: AddDeviceScreen — swap Input + Button (default/outline/link) to shadcn primitives

**Files:**
- Modify: `packages/client/activation/src/ui/AddDeviceScreen.tsx`
- Modify: `packages/client/activation/src/ui/AddDeviceScreen.module.css`
- Test (existing, run as regression check): `packages/client/activation/src/ui/AddDeviceScreen.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Input` (same as Task 1).
- Produces: nothing new consumed by other tasks.

- [ ] **Step 1: Run the existing test to confirm the baseline is green**

Run: `pnpm --filter client exec vitest run activation/src/ui/AddDeviceScreen.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 2: Add the shadcn imports**

In `packages/client/activation/src/ui/AddDeviceScreen.tsx`, insert a new import group between the existing external-package imports and the `../model/add-device-model` import (same convention as Task 1), so the top of the file reads:

```tsx
import { AlertCircle, Camera, Check, Loader2, Lock, ShieldCheck, X } from 'lucide-react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import { useState } from 'react'
import { useZxing } from 'react-zxing'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { type AddDeviceModel, createAddDeviceModel } from '../model/add-device-model'

import styles from './AddDeviceScreen.module.css'
```

- [ ] **Step 3: `choose` mode — scan button, code input, continue button**

Replace:

```tsx
              <button
                type="button"
                className={`${styles.primaryButton} ${styles.primaryButtonTopGap}`}
                onClick={goToScan}
              >
                <Camera size={18} strokeWidth={2} aria-hidden />
                Сканировать QR-код
              </button>
```

with:

```tsx
              <Button
                type="button"
                className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonTopGap}`}
                onClick={goToScan}
              >
                <Camera size={18} strokeWidth={2} aria-hidden />
                Сканировать QR-код
              </Button>
```

Replace:

```tsx
                <input
                  type="text"
                  placeholder="____ – ____"
                  aria-label="Код с другого устройства"
                  aria-invalid={Boolean(error)}
                  value={manualValue}
                  className={`${styles.codeInput} ${error ? styles.codeInputError : ''}`}
                  onChange={(event) => setManualValue(formatManualCode(event.target.value))}
                  onPaste={handleCodePaste}
                  onKeyDown={handleCodeKeyDown}
                />
```

with:

```tsx
                <Input
                  type="text"
                  placeholder="____ – ____"
                  aria-label="Код с другого устройства"
                  aria-invalid={Boolean(error)}
                  value={manualValue}
                  className={`h-12 rounded-[13px] px-[15px] ${styles.codeInput}`}
                  onChange={(event) => setManualValue(formatManualCode(event.target.value))}
                  onPaste={handleCodePaste}
                  onKeyDown={handleCodeKeyDown}
                />
```

Replace:

```tsx
              <button
                type="button"
                className={styles.outlineButton}
                onClick={() => submitCode(manualValue)}
              >
                Продолжить
              </button>
```

with:

```tsx
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full rounded-[13px] font-semibold"
                onClick={() => submitCode(manualValue)}
              >
                Продолжить
              </Button>
```

- [ ] **Step 4: camera-denied fallback link**

Replace:

```tsx
              <button type="button" className={styles.cameraDeniedLink} onClick={goToManual}>
                Ввести код вручную
              </button>
```

with:

```tsx
              <Button
                type="button"
                variant="link"
                className="mt-4 h-auto p-0 text-sm font-semibold"
                onClick={goToManual}
              >
                Ввести код вручную
              </Button>
```

- [ ] **Step 5: `manual` mode — code input, continue button**

Replace:

```tsx
                <input
                  type="text"
                  placeholder="____ – ____"
                  aria-label="Код с другого устройства"
                  aria-invalid={Boolean(error)}
                  value={manualValue}
                  disabled={isExpiredError}
                  className={`${styles.codeInput} ${
                    isExpiredError ? styles.codeInputExpired : error ? styles.codeInputError : ''
                  }`}
                  onChange={(event) => setManualValue(formatManualCode(event.target.value))}
                  onPaste={handleCodePaste}
                  onKeyDown={handleCodeKeyDown}
                />
```

with:

```tsx
                <Input
                  type="text"
                  placeholder="____ – ____"
                  aria-label="Код с другого устройства"
                  aria-invalid={Boolean(error)}
                  value={manualValue}
                  disabled={isExpiredError}
                  className={`h-12 rounded-[13px] px-[15px] ${styles.codeInput} ${
                    isExpiredError ? styles.codeInputExpired : ''
                  }`}
                  onChange={(event) => setManualValue(formatManualCode(event.target.value))}
                  onPaste={handleCodePaste}
                  onKeyDown={handleCodeKeyDown}
                />
```

Replace:

```tsx
              <button
                type="button"
                disabled={isExpiredError}
                className={`${styles.primaryButton} ${styles.primaryButtonManualGap}`}
                onClick={() => submitCode(manualValue)}
              >
                Продолжить
              </button>
```

with:

```tsx
              <Button
                type="button"
                disabled={isExpiredError}
                className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonManualGap}`}
                onClick={() => submitCode(manualValue)}
              >
                Продолжить
              </Button>
```

- [ ] **Step 6: `registering` mode — create-passkey button**

Replace:

```tsx
              <button
                type="button"
                disabled={showRegisterLoading}
                aria-busy={showRegisterLoading}
                className={`${styles.primaryButton} ${styles.primaryButtonTopGap}`}
                onClick={createPasskey}
              >
                {passkeyButtonContent(showRegisterLoading)}
              </button>
```

with:

```tsx
              <Button
                type="button"
                disabled={showRegisterLoading}
                aria-busy={showRegisterLoading}
                className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonTopGap}`}
                onClick={createPasskey}
              >
                {passkeyButtonContent(showRegisterLoading)}
              </Button>
```

- [ ] **Step 7: `rejected` mode — retry button**

Replace:

```tsx
              <button type="button" className={styles.outlineButton} onClick={goToChoose}>
                Попробовать снова
              </button>
```

with:

```tsx
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full rounded-[13px] font-semibold"
                onClick={goToChoose}
              >
                Попробовать снова
              </Button>
```

- [ ] **Step 8: Trim `AddDeviceScreen.module.css`**

Delete: `.primaryButton` base block, `.primaryButton:hover:not(:disabled)`, `.primaryButton:disabled`, `.primaryButton.primaryButtonManualGap:disabled` (the disabled look for this specific button now comes from `Button`'s default `disabled:opacity-50`), `.outlineButton`, `.outlineButton:hover:not(:disabled)`, `.outlineButton:disabled`, `.codeInput`'s `border`/`background`/`outline`/`transition`/`:focus-visible` declarations, `.codeInput.codeInputError` and `.codeInput.codeInputError:focus-visible`, `.cameraDeniedLink` and `.cameraDeniedLink:hover`.

In the `.codeInput` rule, also delete `width`, `height`, and `padding` (superseded by `Input`'s own `w-full` default plus the `h-12`/`px-[15px]` classes added in Steps 3/5) — keep only `font-family`, `font-size`, `font-weight`, `letter-spacing`, and `text-align`. The rule should end up as:

```css
.codeInput {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-align: center;
}
```

Keep everything else as-is: `.primaryButtonTopGap`, `.primaryButtonManualGap` (margin-only), `.codeInput::placeholder`, `.codeInputExpired`, `.codeErrorRow`, and every other rule (`.page`, `.card`, `.brandMark*`, `.brandLabel`, `.stepContent`/`@keyframes stepIn`, `.heading`, `.description`, `.divider*`, `.codeField*`, `.scan*`/`.scanner*`, `.cameraDeniedIcon`/`.cameraDeniedSlash`, `.statusHeading*`, `.statusDescription`, `.registerHeading`, `.spinnerLarge`/`@keyframes spin`, `.statusIcon*`, `.footerNote`).

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter client exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 10: Run the existing test again**

Run: `pnpm --filter client exec vitest run activation/src/ui/AddDeviceScreen.test.tsx`
Expected: PASS (1 test), unchanged from Step 1.

- [ ] **Step 11: Commit**

```bash
git add packages/client/activation/src/ui/AddDeviceScreen.tsx packages/client/activation/src/ui/AddDeviceScreen.module.css
git commit -m "refactor(activation): use shadcn Button/Input in AddDeviceScreen"
```

---

### Task 3: ThemeTogglePill — swap to ToggleGroup and add a regression test

**Files:**
- Modify: `packages/client/activation/src/ui/ThemeTogglePill.tsx`
- Create: `packages/client/activation/src/ui/ThemeTogglePill.test.tsx`

**Interfaces:**
- Consumes: `ToggleGroup`, `ToggleGroupItem` from `@/components/ui/toggle-group` (props: `React.ComponentProps<typeof ToggleGroupPrimitive.Root>` / `.Item`, i.e. `type`, `value`, `aria-label`, `className`, `onClick`, etc. pass straight through); `themeMode` atom from `@/theme/model/theme-model` (already imported today — read via `themeMode()`, written via `themeMode.set(mode)`).
- Produces: `ThemeTogglePill` export unchanged in name/signature (`reatomMemo(() => ..., 'ThemeTogglePill')`, no props) — `ActivateScreen.tsx` (Task 1) keeps rendering `<ThemeTogglePill />` with no changes needed on its side.
- Reference: `packages/client/src/theme/ui/ThemeToggle.tsx` uses this exact `ToggleGroup`/`ToggleGroupItem` pattern already (controlled `value` on the group, per-item `onClick` rather than the group's `onValueChange`) — mirror it, but keep `ThemeTogglePill`'s existing plain `setMode(mode)` call (no view-transition animation — that's `ThemeToggle`-specific and out of scope here).

- [ ] **Step 1: Write the failing test**

Create `packages/client/activation/src/ui/ThemeTogglePill.test.tsx`:

```tsx
import { context } from '@reatom/core'
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { themeMode } from '@/theme/model/theme-model'

import { ThemeTogglePill } from './ThemeTogglePill'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('ThemeTogglePill', () => {
  it('renders a radio per mode inside the Тема group', () => {
    render(<ThemeTogglePill />)
    expect(screen.getByRole('radiogroup', { name: 'Тема' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Светлая тема' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Тёмная тема' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Как в системе' })).toBeInTheDocument()
  })

  it('sets the theme mode on click', () => {
    render(<ThemeTogglePill />)
    fireEvent.click(screen.getByRole('radio', { name: 'Тёмная тема' }))
    expect(themeMode()).toBe('dark')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter client exec vitest run activation/src/ui/ThemeTogglePill.test.tsx`
Expected: FAIL — the current `ThemeTogglePill` renders `role="group"` (not `"radiogroup"`) and plain `<button>`s (no `role="radio"`), so both `getByRole` queries in the first test throw.

- [ ] **Step 3: Swap the markup to `ToggleGroup`/`ToggleGroupItem`**

Replace the full contents of `packages/client/activation/src/ui/ThemeTogglePill.tsx` with:

```tsx
import { wrap } from '@reatom/core'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ThemeMode } from '@/shared/theme/types'
import { themeMode } from '@/theme/model/theme-model'

import styles from './ActivateScreen.module.css'

// Pixel dimensions here (34x34 items, gap 3, padding 4) come straight from
// Activate.dc.html and differ from the board host's own ThemeToggle, so this
// stays a page-scoped component rather than reusing that shared one.
const OPTIONS: { mode: ThemeMode; label: string; title: string; Icon: LucideIcon }[] = [
  { mode: 'light', label: 'Светлая тема', title: 'Светлая', Icon: Sun },
  { mode: 'dark', label: 'Тёмная тема', title: 'Тёмная', Icon: Moon },
  { mode: 'system', label: 'Как в системе', title: 'Системная', Icon: Monitor },
]

function setMode(mode: ThemeMode) {
  wrap(() => themeMode.set(mode))()
}

export const ThemeTogglePill = reatomMemo(() => {
  const current = themeMode()
  return (
    <ToggleGroup type="single" value={current} aria-label="Тема" className={styles.themeToggle}>
      {OPTIONS.map(({ mode, label, title, Icon }) => (
        <ToggleGroupItem
          key={mode}
          value={mode}
          title={title}
          aria-label={label}
          className={styles.themeToggleItem}
          onClick={() => setMode(mode)}
        >
          <Icon size={16} strokeWidth={2} aria-hidden />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}, 'ThemeTogglePill')
```

No CSS changes: `.themeToggle` and `.themeToggleItem[data-state='on']` in `ActivateScreen.module.css` keep working unchanged — Radix's `ToggleGroupItem` sets `data-state="on"/"off"` itself based on whether its `value` matches the group's controlled `value`, the same attribute the old manual `data-state={current === mode ? 'on' : 'off'}` set by hand.

- [ ] **Step 4: Run the test again to verify it passes**

Run: `pnpm --filter client exec vitest run activation/src/ui/ThemeTogglePill.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter client exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/client/activation/src/ui/ThemeTogglePill.tsx packages/client/activation/src/ui/ThemeTogglePill.test.tsx
git commit -m "refactor(activation): use shadcn ToggleGroup in ThemeTogglePill"
```

---

### Task 4: Full verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full client test suite**

Run: `pnpm --filter client test`
Expected: all tests pass, including `activation/src/ui/AddDeviceScreen.test.tsx`, `activation/src/ui/ThemeTogglePill.test.tsx`, `activation/src/model/activation-model.test.ts`, `activation/src/model/add-device-model.test.ts`.

- [ ] **Step 2: Run the workspace typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: no errors (watch for unused-import or unused-CSS-class rules on the trimmed `.module.css` files, if the linter checks those).

- [ ] **Step 4: Manual visual check in a dev server**

Build the activation app once so the board dev server's `activationRoutePlugin` can serve it, then run the standalone activation dev server for live editing:

```bash
pnpm --filter client build:activation
pnpm --filter client exec vite --config vite.activation.config.ts
```

Open the printed local URL and check, in both light and dark theme (via the pill toggle, top-right on `/activate`):
- `/activate` (new-account mode: clear `localStorage['mb_cred_hint']` first) — name field + CTA button look like sized, rounded controls (48px/13px), focus ring and validation-error state on the name field.
- `/add-device` — `choose` screen (scan button, divider, code field, outline continue button), `manual` screen (type text into the code field to see the mono/centered/letter-spaced styling still applied), and the theme-toggle pill's selected/unselected states.

Expected: no layout breakage; colors/hover/focus now follow shadcn defaults (acceptable per the approved design — not pixel-identical to the original `.dc.html` spec).

- [ ] **Step 5: Commit if Step 4 turned up any fixes**

If manual review required follow-up edits, commit them:

```bash
git add -A
git commit -m "fix(activation): address visual issues found in manual review"
```

If no fixes were needed, skip this step (nothing to commit).
