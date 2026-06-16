# Playwright E2E Infrastructure — Design Spec

**Date:** 2026-06-16
**Status:** Approved

## Overview

Add Playwright as a separate E2E layer on top of the existing Vitest unit test suite. The goal is infrastructure only: a working config, a Page Object skeleton, and scripts — no test assertions yet.

## Scope

- Install and configure `@playwright/test`
- Wire Playwright to `vite build && vite preview` (port 4173)
- Add `test:e2e` and `test:e2e:ui` scripts to `package.json`
- Create Page Object stubs for the three main UI areas
- No CI workflow (out of scope for this iteration)

## Configuration (`playwright.config.ts`)

```ts
// Located at project root alongside vite.config.ts
{
  testDir: 'e2e',
  outputDir: 'playwright-report',
  use: {
    baseURL: 'http://localhost:4173',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
  },
}
```

`reuseExistingServer: true` lets developers skip the build when a preview server is already running locally.

## Package Scripts

```json
"test:e2e":    "playwright test"
"test:e2e:ui": "playwright test --ui"
```

## Folder Structure

```
e2e/
  pages/
    BoardPage.ts
    HeaderPage.ts
    OverlayPage.ts
```

## Page Objects

Each class receives `page: Page` in its constructor. They expose locators and action helpers — no assertions.

### `BoardPage`

| Member | Detail |
|--------|--------|
| `widgetCards` | `page.locator('[data-testid="widget-card"]')` |
| `emptyState` | locator for the empty-state element |
| `getCard(index)` | returns the nth widget card locator |
| `expandCard(index)` | clicks the Expand button on card at index |
| `removeCard(index)` | clicks the Remove button on card at index |

### `HeaderPage`

| Member | Detail |
|--------|--------|
| `addWidgetButton` | the "Add widget" trigger button |
| `themeToggle` | the theme toggle button |
| `widgetMenu` | the dropdown `role=menu` |
| `addWidget(name)` | opens menu, clicks the item matching `name` |
| `toggleTheme()` | clicks the theme toggle |

### `OverlayPage`

| Member | Detail |
|--------|--------|
| `dialog` | `page.getByRole('dialog')` |
| `closeButton` | `dialog.getByRole('button', { name: 'Close' })` |
| `waitForOpen()` | waits for dialog to be visible |
| `close()` | clicks the close button |
| `pressEscape()` | dispatches Escape key on the page |

## Usage Pattern (for future tests)

```ts
import { test } from '@playwright/test'
import { BoardPage } from './pages/BoardPage'
import { HeaderPage } from './pages/HeaderPage'
import { OverlayPage } from './pages/OverlayPage'

test('expand a widget', async ({ page }) => {
  const board = new BoardPage(page)
  const header = new HeaderPage(page)
  const overlay = new OverlayPage(page)

  await page.goto('/')
  await header.addWidget('Clock')
  await board.expandCard(0)
  await overlay.waitForOpen()
  await overlay.pressEscape()
})
```

## Out of Scope

- Firefox / WebKit browsers
- CI GitHub Actions workflow
- Fixtures layer (test extends with injected page objects)
- Actual test assertions beyond infrastructure smoke check
