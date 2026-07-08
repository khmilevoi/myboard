import { expect, test } from '@playwright/test'

import { BoardPage } from './pages/BoardPage.js'
import { HeaderPage } from './pages/HeaderPage.js'

test('nginx serves remote entries as JavaScript and never falls back for a missing remote', async ({
  request,
}) => {
  // все действия и экшены лучше хранить на уровне хендлеров, чтобы переюзать логику
  const remote = await request.get('/widgets/clock/remoteEntry.js')
  expect(remote.status()).toBe(200)
  expect(remote.headers()['content-type']).toContain('javascript')
  expect(remote.headers()['cache-control']).toContain('no-cache')
  expect(await remote.text()).not.toContain('<!doctype html>')

  const missing = await request.get('/widgets/missing/remoteEntry.js')
  expect(missing.status()).toBe(404)
  expect(await missing.text()).not.toContain('<div id="root">')
})

test('the production nginx image mounts Clock through the same-origin remote', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await new HeaderPage(page).addWidget('Часы')

  const card = new BoardPage(page).getCard(0)
  await expect(card.getByText(/:/)).toBeVisible()
  //  заебал, че напрямую локатор в тесте ищется? сохрани ёпта
  await expect(card.locator('[class*="skeleton"]')).toHaveCount(0)
})
