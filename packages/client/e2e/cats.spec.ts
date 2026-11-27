import { expect, test } from '@playwright/test'
import { catWeightKey } from 'module-cats/domain/keys'

import { seedCats } from './pages/cats-seed.js'
import { CatsPage } from './pages/CatsPage.js'

// Noon Europe/Warsaw (UTC+1 in November) → server "today" = 2026-11-26.
const PINNED_ISO = '2026-11-26T12:00:00+01:00'
const TODAY = '2026-11-26'

const OFELIA = { id: 'ofelia', name: 'Офелия', litterId: 'ofelia' }
const BUSYA = { id: 'busya', name: 'Буся', litterId: 'busya' }

// An 8x6 RGB PNG (the account-avatar spec's fixture). The browser crops the square chosen in the
// "Обрезать фото" dialog and uploads it as a 256 px WebP into the cat's avatar slot.
const FIXTURE_PNG = {
  name: 'ofelia.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAYElEQVR4nBXMMRVEIQwAwSihRgQiUqNklFBHBCJSo+j+bTvvbUQYYYUdhBNueCFiGtOa9mQ6053e/CCNtNJO0kk3vfyAwWL7d7i87xpllFV2UU655dUHbbTVdtNOu+21H11/PPF87Or0AAAAAElFTkSuQmCC',
    'base64',
  ),
}

// The passport is the standard tier (321–560 px wide, at least 300 px tall). At the default 1280
// px viewport a `w:4` card's frame is ~393 px wide (see ofelia-duty.spec.ts for the arithmetic),
// and a `h:8` card is well over 300 px tall.
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ request }) => {
  await request.post('/api/test/reset')
  await request.post('/api/test/time', { data: { iso: PINNED_ISO } })
  await seedCats(request, [OFELIA])
})

test('one cat — the standard card shows her passport and no switcher', async ({ page }) => {
  const cats = new CatsPage(page)
  await cats.addWidget()

  await cats.expectTier('standard')
  await expect(cats.heading('Офелия')).toBeVisible()
  await expect(cats.weighButton).toBeVisible()
  // Review Focus: one cat, so no chevron, no switcher button and no badge.
  await expect(cats.switcher).toHaveCount(0)
  await expect(cats.card.getByRole('menu')).toHaveCount(0)
})

test('"Взвесить" 4,30 — the card reads the new weight, stored as one weighing', async ({
  page,
  request,
}) => {
  const cats = new CatsPage(page)
  await cats.addWidget()
  await expect(cats.heading('Офелия')).toBeVisible()

  await cats.weigh('4,30')

  await expect(cats.card).toContainText('4,30 кг')
  await expect(cats.card).toContainText('взвешивали сегодня')

  const stored = await request.get(
    `/api/storage/scoped/module/cats/shared/${encodeURIComponent(catWeightKey('ofelia'))}`,
  )
  expect(stored.ok()).toBe(true)
  const { value } = (await stored.json()) as { value: { kg: number; at: string }[] }
  expect(value).toHaveLength(1)
  expect(value[0]).toMatchObject({ kg: 4.3, at: TODAY })
})

test('profile edits — the breed saved in fullscreen is on the card after a reload', async ({
  page,
}) => {
  const cats = new CatsPage(page)
  await cats.addWidget()
  await expect(cats.heading('Офелия')).toBeVisible()

  await cats.openFullscreen()
  const save = cats.overlay.getByRole('button', { name: 'Сохранить', exact: true })
  await expect(save).toBeDisabled()
  await cats.overlay.getByLabel('Порода').fill('Британская короткошёрстная')
  await expect(
    cats.overlay.getByText('Изменения не сохранены · цель сохраняется отдельно'),
  ).toBeVisible()
  await save.click()
  await expect(cats.overlay.getByText('Все изменения сохранены')).toBeVisible()
  await expect(save).toBeDisabled()

  await page.reload()
  await expect(cats.overlay).toHaveCount(0)
  await cats.expectTier('standard')
  await expect(cats.card.getByText('Британская короткошёрстная')).toBeVisible()
})

// Review Focus: a popover or a form closed inside fullscreen closes only that layer.
test('layers close one at a time — the fullscreen overlay stays', async ({ page, request }) => {
  await seedCats(request, [OFELIA, BUSYA])
  const cats = new CatsPage(page)
  await cats.addWidget()
  await expect(cats.heading('Офелия')).toBeVisible()
  await cats.openFullscreen()

  const switcher = cats.overlay.getByRole('button', { name: /^Выбрать кошку/ })
  const menu = page.getByRole('menu', { name: 'Кошки' })

  // The switcher, closed with Escape.
  await switcher.click()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(cats.overlay).toBeVisible()

  // The switcher, closed with a click outside it (on the overlay's own header). The box is read
  // first: an open modal menu hides everything else from the accessibility tree.
  const box = await cats.overlay.getByRole('heading', { name: 'Офелия' }).boundingBox()
  if (!box) throw new Error('the fullscreen heading has no layout box')
  await switcher.click()
  await expect(menu).toBeVisible()
  await page.mouse.click(box.x + 4, box.y + box.height / 2)
  await expect(menu).toHaveCount(0)
  await expect(cats.overlay).toBeVisible()

  // The weigh form, closed with Escape, then with the browser's Back.
  await cats.tab('Вес').click()
  const weigh = page.getByRole('dialog', { name: 'Вес · Офелия' })
  await cats.overlay.getByRole('button', { name: 'Взвесить', exact: true }).click()
  await expect(weigh).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(weigh).toHaveCount(0)
  await expect(cats.overlay).toBeVisible()

  await cats.overlay.getByRole('button', { name: 'Взвесить', exact: true }).click()
  await expect(weigh).toBeVisible()
  await page.goBack()
  await expect(weigh).toHaveCount(0)
  await expect(cats.overlay).toBeVisible()
  await expect(cats.tab('Вес')).toHaveAttribute('aria-pressed', 'true')
})

test('the avatar — cropped, uploaded to the slot, on every avatar, and removed', async ({
  page,
}) => {
  // The file service reads and writes with a session, as nginx's auth_request does in production.
  const seeded = await page.request.post('/api/test/seed-session')
  expect(seeded.ok()).toBe(true)
  const cats = new CatsPage(page)
  await cats.addWidget()
  await expect(cats.heading('Офелия')).toBeVisible()
  await cats.openFullscreen()

  await expect(cats.overlay.getByText('Без фото — буква на цвете кошки')).toBeVisible()
  await cats.overlay.getByTestId('cat-avatar-input').setInputFiles(FIXTURE_PNG)
  const crop = page.getByRole('dialog', { name: 'Обрезать фото' })
  await expect(crop).toBeVisible()
  await expect(crop.getByTestId('avatar-crop-stage')).toHaveAttribute('data-shape', 'cat')
  await expect(crop.getByText('Шапка карточки')).toBeVisible()
  await crop.getByTestId('avatar-crop-save').click()
  await expect(crop).toHaveCount(0)

  // The profile's own avatar; the "Лоток" option draws the cat's avatar too.
  const about = cats.overlay.getByRole('region', { name: 'О кошке' })
  await expect(about.locator('img[src^="/files/"]')).toHaveCount(1)
  await expect(cats.overlay.getByRole('button', { name: 'Убрать фото' })).toBeVisible()
  await cats.overlay.getByRole('button', { name: 'Закрыть' }).click()
  await expect(cats.overlay).toHaveCount(0)

  const cardPhoto = cats.card.locator('img[src^="/files/"]')
  await expect(cardPhoto).toHaveCount(1)
  await page.reload()
  await expect(cardPhoto).toHaveCount(1)

  await cats.openFullscreen()
  await cats.overlay.getByRole('button', { name: 'Убрать фото' }).click()
  await expect(cats.overlay.getByText('Без фото — буква на цвете кошки')).toBeVisible()
  await expect(about.locator('img[src^="/files/"]')).toHaveCount(0)
  await expect(cats.overlay.locator('img[src^="/files/"]')).toHaveCount(0)
  await cats.overlay.getByRole('button', { name: 'Закрыть' }).click()
  await expect(cardPhoto).toHaveCount(0)
})
