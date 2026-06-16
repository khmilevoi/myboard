# Playwright E2E Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Playwright with Chromium, wire it to `vite preview`, and create Page Object stubs ready for future E2E tests.

**Architecture:** Playwright runs against a production preview build (`vite build && vite preview`) on port 4173. Page Objects live in `e2e/pages/` and receive a Playwright `Page` object in their constructor. A separate `tsconfig.e2e.json` handles type-checking for the `e2e/` tree so it doesn't pollute the main app config.

**Tech Stack:** `@playwright/test`, Chromium, TypeScript (separate tsconfig), Vite preview server.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `playwright.config.ts` | Playwright config — chromium, port 4173, webServer |
| Create | `tsconfig.e2e.json` | TS config for `e2e/` tree |
| Modify | `package.json` | Add `test:e2e`, `test:e2e:ui`, `typecheck:e2e` scripts |
| Modify | `.gitignore` | Ignore Playwright artifacts |
| Create | `e2e/pages/BoardPage.ts` | Locators and actions for the widget grid |
| Create | `e2e/pages/HeaderPage.ts` | Locators and actions for the header bar |
| Create | `e2e/pages/OverlayPage.ts` | Locators and actions for the fullscreen overlay |

---

## Task 1: Install Playwright and download Chromium

**Files:**
- Modify: `package.json` (devDependencies)

- [ ] **Step 1: Install the package**

```bash
npm install --save-dev @playwright/test
```

Expected: `@playwright/test` appears in `package.json` devDependencies.

- [ ] **Step 2: Download Chromium browser binary**

```bash
npx playwright install chromium
```

Expected output contains a line like:
```
Chromium 130.x.x (playwright build ...) downloaded to ...
```

- [ ] **Step 3: Verify installation**

```bash
npx playwright --version
```

Expected: prints `Version 1.x.x` (any recent version).

- [ ] **Step 4: Add Playwright artifacts to .gitignore**

The project root has a `.gitignore`. Add these two lines at the end:

```
# Playwright
playwright-report/
test-results/
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: install @playwright/test and download Chromium"
```

---

## Task 2: Create playwright.config.ts and update package.json scripts

**Files:**
- Create: `playwright.config.ts`
- Create: `tsconfig.e2e.json`
- Modify: `package.json` (scripts section)

- [ ] **Step 1: Create `playwright.config.ts` at the project root**

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:4173',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
  },
})
```

Key decisions:
- `reuseExistingServer: !process.env['CI']` — in local dev, skips rebuilding if `vite preview` is already running; in CI always rebuilds.
- `outputDir: 'test-results'` — where Playwright writes screenshots and traces on failure.
- `screenshot: 'only-on-failure'` — captures a screenshot automatically when a test fails.

- [ ] **Step 2: Create `tsconfig.e2e.json` at the project root**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["e2e/**/*", "playwright.config.ts"]
}
```

Why a separate tsconfig:
- The main `tsconfig.json` includes `vitest/globals` and `@testing-library/jest-dom` types — wrong for Playwright.
- `moduleResolution: "node"` (not `"bundler"`) because Playwright runs tests in Node.js, not through Vite.
- `@playwright/test` types are automatically available via `skipLibCheck` and the `@playwright/test` package itself (no explicit `types` entry needed).

- [ ] **Step 3: Add scripts to package.json**

In `package.json`, add three scripts to the `"scripts"` block:

```json
"test:e2e":     "playwright test",
"test:e2e:ui":  "playwright test --ui",
"typecheck:e2e": "tsc -p tsconfig.e2e.json --noEmit"
```

The full scripts block becomes:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc --noEmit --incremental false -p tsconfig.json && tsc --noEmit --incremental false -p tsconfig.node.json && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui",
  "typecheck": "tsc --noEmit --incremental false -p tsconfig.json && tsc --noEmit --incremental false -p tsconfig.node.json",
  "typecheck:e2e": "tsc -p tsconfig.e2e.json --noEmit"
}
```

- [ ] **Step 4: Create `e2e/` directory with a placeholder so git tracks it**

Create `e2e/.gitkeep` (empty file). This lets git track the folder before any test files exist.

- [ ] **Step 5: Verify Playwright config loads correctly**

```bash
npx playwright test --pass-with-no-tests --list
```

Expected output: zero tests found, exits 0. No error about config parsing or missing binaries.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tsconfig.e2e.json package.json e2e/.gitkeep
git commit -m "chore: add playwright.config.ts and e2e scripts"
```

---

## Task 3: Create Page Object stubs

**Files:**
- Create: `e2e/pages/BoardPage.ts`
- Create: `e2e/pages/HeaderPage.ts`
- Create: `e2e/pages/OverlayPage.ts`

Each class: receives `page: Page` in constructor, exposes typed `Locator` properties, and provides action methods that return `Promise<void>`. No assertions anywhere in these files.

Locators derive from actual DOM attributes found in the source:
- `[data-testid="widget-card"]` — set in `src/board/Board.tsx:47`
- `aria-label="Expand"` / `aria-label="Remove"` — `src/board/Board.tsx:56,62`
- `aria-label="Add widget"` text content — `src/board/AddWidgetMenu.tsx:23`
- `role="menu"` — `src/board/AddWidgetMenu.tsx:31`
- `role="menuitem"` — `src/board/AddWidgetMenu.tsx:33`
- `role="group" aria-label="Theme"` — `src/app/ThemeToggle.tsx:35`
- Theme button labels: `"Light"`, `"Dark"`, `"System theme"` — `src/app/ThemeToggle.tsx:10-12`
- `role="dialog"` — `src/widget-host/FullscreenOverlay.tsx:38`
- `aria-label="Close"` — `src/widget-host/FullscreenOverlay.tsx:41`
- Empty state heading `"No widgets yet"` — `src/board/EmptyState.tsx:7`

- [ ] **Step 1: Create `e2e/pages/BoardPage.ts`**

```ts
import type { Locator, Page } from '@playwright/test'

export class BoardPage {
  readonly widgetCards: Locator
  readonly emptyState: Locator

  constructor(readonly page: Page) {
    this.widgetCards = page.locator('[data-testid="widget-card"]')
    this.emptyState = page.getByRole('heading', { name: 'No widgets yet' })
  }

  getCard(index: number): Locator {
    return this.widgetCards.nth(index)
  }

  async expandCard(index: number): Promise<void> {
    await this.getCard(index).getByRole('button', { name: 'Expand' }).click()
  }

  async removeCard(index: number): Promise<void> {
    await this.getCard(index).getByRole('button', { name: 'Remove' }).click()
  }
}
```

- [ ] **Step 2: Create `e2e/pages/HeaderPage.ts`**

```ts
import type { Locator, Page } from '@playwright/test'

export class HeaderPage {
  readonly addWidgetButton: Locator
  readonly themeToggle: Locator
  readonly widgetMenu: Locator

  constructor(readonly page: Page) {
    this.addWidgetButton = page.getByRole('button', { name: 'Add widget' })
    this.themeToggle = page.getByRole('group', { name: 'Theme' })
    this.widgetMenu = page.getByRole('menu')
  }

  async addWidget(name: string): Promise<void> {
    await this.addWidgetButton.click()
    await this.widgetMenu.getByRole('menuitem', { name }).click()
  }

  async setTheme(mode: 'Light' | 'Dark' | 'System theme'): Promise<void> {
    await this.themeToggle.getByRole('button', { name: mode }).click()
  }
}
```

Note: `setTheme` replaces the spec's `toggleTheme()` because the theme control has three named states (Light / Dark / System theme), not a binary toggle.

- [ ] **Step 3: Create `e2e/pages/OverlayPage.ts`**

```ts
import type { Locator, Page } from '@playwright/test'

export class OverlayPage {
  readonly dialog: Locator
  readonly closeButton: Locator

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog')
    this.closeButton = this.dialog.getByRole('button', { name: 'Close' })
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

- [ ] **Step 4: Type-check the e2e tree**

```bash
npm run typecheck:e2e
```

Expected: exits 0 with no output.

- [ ] **Step 5: Verify Playwright still lists zero tests cleanly**

```bash
npx playwright test --pass-with-no-tests --list
```

Expected: exits 0, no config errors.

- [ ] **Step 6: Commit**

```bash
git add e2e/pages/BoardPage.ts e2e/pages/HeaderPage.ts e2e/pages/OverlayPage.ts
git commit -m "feat(e2e): add Playwright Page Object stubs (BoardPage, HeaderPage, OverlayPage)"
```
