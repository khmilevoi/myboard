import { expect, test } from '@playwright/test'

import { HeaderPage } from './pages/HeaderPage.js'

// 768px is MOBILE_BREAKPOINT (packages/client/src/board/model/grid-metrics.ts),
// the same threshold ThemeToggle.module.css's media query uses to swap the
// three-item group for the single cycling button. This is the only layer
// where that media query is real -- jsdom never evaluates it, so the unit
// tests only assert both controls are wired, not which one is visible.
const WIDE_VIEWPORT = { width: 1280, height: 800 }
const NARROW_VIEWPORT = { width: 500, height: 800 }

// Mirrors THEME_STORAGE_KEY in src/theme/model/theme-storage.ts. Not
// imported: e2e specs in this repo read localStorage by literal key rather
// than importing from src (see mobile-board.spec.ts, nginx-gate.spec.ts).
const THEME_STORAGE_KEY = 'myboard.theme'

test('shows the three-item theme group at a wide viewport', async ({ page }) => {
  await page.setViewportSize(WIDE_VIEWPORT)
  await page.goto('/')

  const header = new HeaderPage(page)
  await expect(header.themeToggle).toBeVisible()
  await expect(header.themeCycleButton).toBeHidden()
})

test('shows the single cycling button at a narrow viewport', async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT)
  await page.goto('/')

  const header = new HeaderPage(page)
  await expect(header.themeToggle).toBeHidden()
  await expect(header.themeCycleButton).toBeVisible()
})

test('the cycling button still drives the theme model at a narrow viewport', async ({ page }) => {
  // Seed a known mode instead of asserting against the resolved (light/dark)
  // appearance -- 'system' resolves differently depending on the host's own
  // color-scheme preference, which would make an appearance-based assertion
  // flaky. The mode itself, persisted to localStorage, is deterministic.
  await page.addInitScript((key: string) => localStorage.setItem(key, 'light'), THEME_STORAGE_KEY)
  await page.setViewportSize(NARROW_VIEWPORT)
  await page.goto('/')

  const header = new HeaderPage(page)
  await header.themeCycleButton.click()

  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY))
    .toBe('dark')
})
