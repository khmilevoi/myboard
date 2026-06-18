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
  await header.addWidget('Clock')
  await expect(new BoardPage(page).widgetCards).toHaveCount(1)
}

test('theme buttons switch the document theme', async ({ page }) => {
  await page.goto('/')

  const header = new HeaderPage(page)
  await header.setTheme('Dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(header.themeToggle.getByRole('button', { name: 'Dark' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await header.setTheme('Light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(header.themeToggle.getByRole('button', { name: 'Light' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('widget can be expanded without duplicate fullscreen or close controls', async ({ page }) => {
  await seedClockWidget(page)

  const board = new BoardPage(page)
  await expect(board.getCard(0).getByRole('button', { name: 'Expand' })).toHaveCount(1)
  await expect(board.getCard(0).locator('iframe')).toHaveCount(0)

  await board.expandCard(0)
  const overlay = new OverlayPage(page)
  await overlay.waitForOpen()
  await expect(overlay.dialog).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Close' })).toHaveCount(1)
  await expect(overlay.dialog.locator('iframe')).toHaveCount(0)

  await overlay.close()
  await expect(overlay.dialog).toHaveCount(0)
})

test('widget loading skeleton disappears after the loadable component is ready', async ({ page }) => {
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
