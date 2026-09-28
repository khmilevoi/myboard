import { expect, test } from '@playwright/test'

import { BoardPage } from './pages/BoardPage.js'
import { CatCarePage } from './pages/CatCarePage.js'
import { HeaderPage } from './pages/HeaderPage.js'

const PINNED_ISO = '2026-09-28T12:00:00+02:00'
const WRITE_PATH = '/api/widgets/cat-care/write'

test.use({ viewport: { width: 1440, height: 1000 } })
test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/test/reset')).ok()).toBe(true)
  expect((await request.post('/api/test/time', { data: { iso: PINNED_ISO } })).ok()).toBe(true)
})

test('catalog, eaten/offered meals, historical snapshots, reload and separate placements', async ({
  page,
}) => {
  const cat = new CatCarePage(page)
  await cat.add()
  await cat.addProduct()
  await cat.feed()
  await expect(cat.eaten).toHaveText('120')
  await cat.feed({ grams: '20', mode: 'offered' })
  await expect(cat.eaten).toHaveText('120')
  await expect(cat.pending).toContainText('80')

  // Changing a product must not retrospectively change yesterday's or
  // today's observations. A later quantity edit retains the same snapshot.
  await cat.tab('Продукты')
  await cat.dialog
    .getByRole('listitem')
    .filter({ has: page.getByText('Тестовый корм', { exact: true }) })
    .getByRole('button', { name: 'Изменить', exact: true })
    .click()
  await cat.dialog.getByLabel('Калорийность', { exact: true }).fill('100')
  await cat.save()
  await cat.tab('Дневник')
  await expect(cat.eaten).toHaveText('120')
  const offered = cat.dialog.getByTestId('cat-care-food-record').filter({ hasText: 'Выдано' })
  await offered.getByRole('button', { name: /Изменить/ }).click()
  await cat.dialog.getByLabel('Осталось, г', { exact: true }).fill('5')
  await cat.save()
  await expect(cat.eaten).toHaveText('180')
  await expect(cat.pending).toHaveCount(0)

  await page.reload()
  await cat.open()
  await expect(cat.eaten).toHaveText('180')
  await cat.close()
  await new HeaderPage(page).addWidget('Питание кошки')
  await expect(new BoardPage(page).widgetCards).toHaveCount(2)
  // Board instances are prepended even though the visual grid places the
  // newest card below the existing cards.
  await cat.open(0)
  await expect(cat.eaten).toHaveText('—')
  await cat.tab('Продукты')
  await expect(cat.dialog.getByText('Тестовый корм', { exact: true })).toHaveCount(0)
})

test('water observations, weight graph and adopted daily goal use the real server', async ({
  page,
}) => {
  const cat = new CatCarePage(page)
  await cat.add()
  await cat.dialog.getByRole('button', { name: 'Вода', exact: true }).click()
  await cat.dialog.getByLabel('Налили свежей воды, мл', { exact: true }).fill('250')
  await cat.dialog.getByLabel('Когда меняли / доливали', { exact: true }).fill('2026-09-27T12:00')
  await cat.save()
  await expect(cat.dialog.getByTestId('cat-care-water-interval')).toHaveText('Нет оценки')
  await cat.dialog.getByRole('button', { name: 'Вода', exact: true }).click()
  await cat.dialog.getByLabel('Налили свежей воды, мл', { exact: true }).fill('300')
  await cat.dialog.getByLabel('Осталось до замены / долива, мл', { exact: true }).fill('150')
  await cat.save()
  await expect(cat.dialog.getByTestId('cat-care-water-interval').first()).toContainText('100')

  await cat.dialog.getByRole('button', { name: 'Вес', exact: true }).click()
  await cat.dialog.getByLabel('Вес, кг', { exact: true }).fill('4,2')
  // The test API's clock is frozen while the browser clock advances between
  // re-syncs. Use a measured past time so a resync cannot put this fixture a
  // few milliseconds in the future. Fresh-now behavior has a model regression.
  await cat.dialog.getByLabel('Когда взвешивали', { exact: true }).fill('2026-09-28T11:55')
  await cat.save()
  await cat.tab('Профиль')
  await cat.dialog.getByRole('button', { name: 'Изменить профиль', exact: true }).click()
  await cat.dialog.getByLabel('Имя кошки', { exact: true }).fill('Луна')
  await cat.dialog.getByLabel('Дата рождения', { exact: true }).fill('2022-05-10')
  await cat.dialog.getByLabel('Стерилизация', { exact: true }).selectOption('yes')
  await cat.dialog.getByRole('button', { name: 'Использовать ориентир', exact: true }).click()
  await expect(cat.dialog.getByLabel('Цель, ккал в сутки', { exact: true })).toHaveValue('246')
  await cat.save()
  await page.reload()
  await cat.open()
  await cat.tab('Профиль')
  await expect(cat.dialog).toContainText('Луна')
  await expect(cat.dialog).toContainText('246')
  await cat.tab('История и статистика')
  await expect(cat.dialog.getByRole('img', { name: /вес/i })).toBeVisible()
})

test('a failed save keeps the draft and retries the same operation once', async ({ page }) => {
  const cat = new CatCarePage(page)
  await cat.add()
  await cat.addProduct()
  const mutationIds: string[] = []
  let failNext = true
  await page.route(`**${WRITE_PATH}`, async (route) => {
    const body = route.request().postDataJSON() as { payload: { mutationId: string } }
    mutationIds.push(body.payload.mutationId)
    if (failNext) {
      failNext = false
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await cat.dialog.getByRole('button', { name: 'Кормление', exact: true }).click()
  await cat.dialog.getByLabel('Порция, г', { exact: true }).fill('42')
  await cat.dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(cat.dialog.getByRole('alert')).toContainText('соединения')
  await expect(cat.dialog.getByLabel('Порция, г', { exact: true })).toHaveValue('42')
  await cat.save()
  await expect(cat.eaten).toHaveText('168')
  expect(mutationIds).toHaveLength(2)
  expect(mutationIds[0]).toBe(mutationIds[1])
  await page.reload()
  await cat.open()
  await expect(cat.eaten).toHaveText('168')
})

test('mobile can reach the last navigation tab and save a tall profile form', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const cat = new CatCarePage(page)
  await cat.add()
  await cat.tab('Профиль')
  const navigation = cat.dialog.getByRole('navigation', { name: 'Разделы дневника' })
  expect(await navigation.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  const edit = cat.dialog.getByRole('button', { name: 'Изменить профиль', exact: true })
  await edit.focus()
  await page.keyboard.press('Enter')
  await cat.dialog.getByLabel('Имя кошки', { exact: true }).fill('Мобильная кошка')
  await cat.dialog.getByLabel('Цель, ккал в сутки', { exact: true }).fill('240')
  await cat.save()
  await expect(
    cat.dialog.getByRole('heading', { name: 'Мобильная кошка', exact: true }).last(),
  ).toBeVisible()
  await expect(cat.dialog).toContainText('240 ккал')
})

test('real board sizes keep summary and primary controls visible and usable', async ({ page }) => {
  test.setTimeout(90_000)
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  const cat = new CatCarePage(page)
  await cat.add()
  await cat.addProduct('Сухой корм с очень длинным названием продукта для проверки переноса', '400')
  await cat.feed()
  await cat.tab('Профиль')
  await cat.dialog.getByRole('button', { name: 'Изменить профиль', exact: true }).click()
  await cat.dialog
    .getByLabel('Имя кошки', { exact: true })
    .fill('КошечкаСОченьДлиннымИменемБезПробеловДляПроверкиКарточки')
  await cat.save()
  await cat.close()
  const card = new BoardPage(page).getCard(0)
  const tile = card.getByTestId('cat-care-widget')
  const matrix = [
    { name: 'minimum', w: 2, h: 3, tier: 'tiny' },
    { name: 'compact', w: 3, h: 5, tier: 'compact' },
    { name: 'standard', w: 4, h: 8, tier: 'standard' },
    { name: 'large', w: 5, h: 11, tier: 'large' },
    { name: 'wide short', w: 8, h: 3, tier: 'tiny' },
    { name: 'narrow tall', w: 2, h: 12, tier: 'tiny' },
    { name: 'default', w: 5, h: 8, tier: 'standard' },
    { name: 'narrow desktop minimum', w: 2, h: 3, tier: 'tiny', viewport: 834 },
    { name: 'mobile minimum', w: 1, h: 3, tier: 'tiny', viewport: 390 },
  ] as const
  for (const size of matrix) {
    await test.step(size.name, async () => {
      if ('viewport' in size) await page.setViewportSize({ width: size.viewport, height: 1000 })
      await cat.resizeCard(size.w, size.h)
      await expect(tile).toHaveAttribute('data-tier', size.tier)
      await expect(tile.getByTestId('cat-care-eaten-kcal')).toHaveText('120')
      await card.hover()
      const bounds = (await tile.boundingBox())!
      for (const name of ['Кормление', 'Развернуть']) {
        const control = tile.getByRole('button', { name, exact: true })
        await expect(control).toBeVisible()
        const box = (await control.boundingBox())!
        expect(box.x, `${name}: left edge`).toBeGreaterThanOrEqual(bounds.x - 1)
        expect(box.y, `${name}: top edge`).toBeGreaterThanOrEqual(bounds.y - 1)
        expect(box.x + box.width, `${name}: right edge`).toBeLessThanOrEqual(
          bounds.x + bounds.width + 1,
        )
        expect(box.y + box.height, `${name}: bottom edge`).toBeLessThanOrEqual(
          bounds.y + bounds.height + 1,
        )
        await control.click({ trial: true })
      }
      expect(await tile.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
        true,
      )
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true)
      const screenshot = test.info().outputPath(`cat-care-${size.name.replaceAll(' ', '-')}.png`)
      await card.screenshot({ path: screenshot })
      await test.info().attach(`cat-care-${size.name.replaceAll(' ', '-')}`, {
        path: screenshot,
        contentType: 'image/png',
      })
      await tile.getByRole('button', { name: 'Кормление', exact: true }).click()
      await expect(cat.dialog).toHaveCount(1)
      await expect(cat.dialog.getByLabel('Порция, г', { exact: true })).toBeVisible()
      await expect(cat.dialog.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(
        1,
      )
      await cat.dialog
        .getByRole('button', { name: 'Сохранить', exact: true })
        .click({ trial: true })
      await cat.close()
    })
  }
  expect(runtimeErrors).toEqual([])
})
