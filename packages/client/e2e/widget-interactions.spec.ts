import { expect, test, type Page } from '@playwright/test'

import { BoardPage } from './pages/BoardPage.js'
import { HeaderPage } from './pages/HeaderPage.js'
import { OverlayPage } from './pages/OverlayPage.js'

async function seedClockWidget(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
  })
  await page.reload()

  const header = new HeaderPage(page)
  await header.addWidget('Часы')
  await expect(new BoardPage(page).widgetCards).toHaveCount(1)
}

test('theme buttons switch the document theme', async ({ page }) => {
  await page.goto('/')

  const header = new HeaderPage(page)
  await header.setTheme('Тёмная тема')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(header.themeToggle.getByRole('radio', { name: 'Тёмная тема' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await header.setTheme('Светлая тема')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(header.themeToggle.getByRole('radio', { name: 'Светлая тема' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('widget can be expanded without duplicate fullscreen or close controls', async ({ page }) => {
  await seedClockWidget(page)

  const board = new BoardPage(page)
  await expect(board.getCard(0).getByRole('button', { name: 'Развернуть' })).toHaveCount(1)
  await expect(board.getCard(0).locator('iframe')).toHaveCount(0)

  // The desktop half of the visibility rule, which mobile-board.spec.ts cannot
  // reach: that file runs under `hasTouch: true`, where the `@media (hover: hover)`
  // block is inactive. Read opacity off the controls container — opacity is not
  // inherited, so asserting it on the button would always report the button's own
  // untouched `1` and could never fail.
  const controls = board.getCard(0).locator('[data-placement="overlay"]')
  await expect(controls).toHaveCSS('opacity', '0')
  await board.getCard(0).hover()
  await expect(controls).toHaveCSS('opacity', '1')

  await board.expandCard(0)
  const overlay = new OverlayPage(page)
  await overlay.waitForOpen()
  await expect(overlay.dialog).toHaveCount(1)
  // Clock draws its own "Закрыть" control in fullscreen mode (Clock.tsx:
  // WidgetControls in the mode === 'large' branch) — a phone has no Esc key,
  // so every widget must draw a visible way out of fullscreen. The dialog
  // itself (FullscreenOverlay.tsx) deliberately provides no chrome of its
  // own, so exactly one "Закрыть" button must exist here; a second one would
  // mean the dialog started stacking its own close control on top of the
  // widget's.
  await expect(page.getByRole('button', { name: 'Закрыть' })).toHaveCount(1)
  await expect(overlay.dialog.locator('iframe')).toHaveCount(0)

  await overlay.pressEscape()
  await expect(overlay.dialog).toHaveCount(0)
})

test('widget loading skeleton disappears after the loadable component is ready', async ({
  page,
}) => {
  await seedClockWidget(page)

  const card = new BoardPage(page).getCard(0)
  await expect(card).toContainText(':')
  await expect(card.locator('iframe')).toHaveCount(0)
  await expect(card.locator('[class*="skeleton"]')).toHaveCount(0)
})

test('widget can be resized from the southeast handle', async ({ page }) => {
  await seedClockWidget(page)

  const card = new BoardPage(page).getCard(0)
  const before = await card.boundingBox()
  expect(before).not.toBeNull()

  const handle = card.locator('.react-resizable-handle-se')
  await expect(handle).toBeVisible()
  const handleBox = await handle.boundingBox()
  expect(handleBox).not.toBeNull()

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x + 150, handleBox!.y + 90, { steps: 8 })
  await page.mouse.up()

  const after = await card.boundingBox()
  expect(after).not.toBeNull()
  expect(after!.width).toBeGreaterThan(before!.width + 40)
  expect(after!.height).toBeGreaterThan(before!.height + 20)
})

test('widget can be dragged by its handle without runtime errors', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await seedClockWidget(page)

  const card = new BoardPage(page).getCard(0)
  const before = await card.boundingBox()
  expect(before).not.toBeNull()

  const handle = card.locator('.widget-drag-handle')
  await expect(handle).toBeVisible()
  const handleBox = await handle.boundingBox()
  expect(handleBox).not.toBeNull()

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x + 260, handleBox!.y + 80, { steps: 10 })
  await page.mouse.up()

  const after = await card.boundingBox()
  expect(after).not.toBeNull()
  expect(after!.x).toBeGreaterThan(before!.x + 40)
  await expect(card.locator('[class*="skeleton"]')).toHaveCount(0)
  expect(consoleErrors).not.toContainEqual(expect.stringContaining('process is not defined'))
})

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
