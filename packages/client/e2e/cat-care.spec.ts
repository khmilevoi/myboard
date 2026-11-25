import { expect, test } from '@playwright/test'

import { ActivatePage } from './pages/ActivatePage.js'
import { BoardPage } from './pages/BoardPage.js'
import { CatCarePage } from './pages/CatCarePage.js'
import { HeaderPage } from './pages/HeaderPage.js'
import { seedInvite } from './support/seed.js'
import { enableVirtualAuthenticator } from './support/webauthn.js'

const PINNED_ISO = '2026-09-28T12:00:00+02:00'
const WRITE_PATH = '/api/widgets/cat-care/write'

test.use({ viewport: { width: 1440, height: 1000 } })
test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/test/reset')).ok()).toBe(true)
  expect((await request.post('/api/test/time', { data: { iso: PINNED_ISO } })).ok()).toBe(true)
})

test('quick entries need only the amount, keep details optional and record topups honestly', async ({
  page,
}) => {
  const cat = new CatCarePage(page)
  const capture = async (name: string) => {
    const path = test.info().outputPath(`quick-${name}.png`)
    await cat.dialog.screenshot({ path })
    await test.info().attach(`quick-${name}`, { path, contentType: 'image/png' })
  }
  const expectQuickSaveReachable = async () => {
    const save = cat.dialog.getByRole('button', { name: 'Сохранить', exact: true })
    const box = (await save.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(500)
    await save.click({ trial: true })
  }
  const commands: Array<{
    kind: string
    food?: { mode: string; grams: number }
    water?: { kind: string; addedMl: number; remainingMl: number | null }
  }> = []
  page.on('request', (request) => {
    if (request.url().endsWith(WRITE_PATH)) commands.push(request.postDataJSON().payload.command)
  })
  await cat.add()
  await cat.addProduct()
  await capture('desktop-home')
  await cat.dialog.getByRole('button', { name: 'Еда', exact: true }).click()
  await capture('desktop-food')
  await page.setViewportSize({ width: 390, height: 500 })
  await capture('mobile-food')
  await expect(
    cat.dialog.locator('form input:visible, form select:visible, form textarea:visible'),
  ).toHaveCount(2)
  await expect(cat.dialog.getByLabel('Когда кормили', { exact: true })).toBeHidden()
  await expectQuickSaveReachable()
  await expect(cat.dialog.getByLabel('Съедено, г', { exact: true })).toBeFocused()
  await cat.dialog.getByLabel('Съедено, г', { exact: true }).fill('25')
  await cat.dialog.getByLabel('Съедено, г', { exact: true }).press('Enter')
  await expect(cat.eaten).toHaveText('100')
  for (const name of ['Еда', 'Вода', 'Вес']) {
    const button = cat.dialog.getByRole('button', { name, exact: true })
    const box = (await button.boundingBox())!
    expect(box.y, `${name} stays in the first short screen`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `${name} stays in the first short screen`).toBeLessThanOrEqual(500)
    await button.click({ trial: true })
  }
  await capture('mobile-home')
  expect(commands.find((command) => command.kind === 'food.save')?.food).toMatchObject({
    grams: 25,
    mode: 'eaten',
  })

  await cat.dialog.getByRole('button', { name: 'Вода', exact: true }).click()
  await expect(
    cat.dialog.locator('form input:visible, form select:visible, form textarea:visible'),
  ).toHaveCount(2)
  await expect(cat.dialog.getByLabel('Когда меняли / доливали', { exact: true })).toBeHidden()
  await expectQuickSaveReachable()
  await capture('mobile-water')
  await cat.dialog.getByLabel('Единица', { exact: true }).selectOption('g')
  await expect(cat.dialog.getByText('Введите число', { exact: true })).toHaveCount(0)
  await cat.dialog.getByLabel('Долито, г', { exact: true }).fill('75,5')
  await cat.dialog.getByLabel('Долито, г', { exact: true }).press('Enter')
  await expect(cat.dialog.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0)
  expect(commands.find((command) => command.kind === 'water.save')?.water).toMatchObject({
    kind: 'topup',
    addedMl: 75.5,
    remainingMl: null,
  })
  await cat.dialog.locator('summary', { hasText: 'Вода и вес подробно' }).click()
  await expect(cat.dialog.getByTestId('cat-care-water-interval')).toHaveText('Нет оценки')
  await cat.dialog.getByRole('button', { name: 'Вода', exact: true }).click()
  await expect(cat.dialog.getByLabel('Долито, г', { exact: true })).toHaveValue('75,5')
  await cat.save()

  await cat.dialog.getByRole('button', { name: 'Вес', exact: true }).click()
  await expect(
    cat.dialog.locator('form input:visible, form select:visible, form textarea:visible'),
  ).toHaveCount(1)
  await expectQuickSaveReachable()
  await capture('mobile-weight')
  await cat.dialog.getByLabel('Вес, кг', { exact: true }).fill('4,2')
  await cat.dialog.getByLabel('Вес, кг', { exact: true }).press('Enter')
  await expect(cat.dialog.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0)

  await cat.dialog.getByRole('button', { name: 'Еда', exact: true }).click()
  await cat.details()
  await cat.dialog.getByLabel('Заметка', { exact: true }).fill('x'.repeat(2001))
  await cat.dialog.locator('summary', { hasText: 'Время и подробности' }).click()
  await cat.dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(cat.dialog.getByLabel('Заметка', { exact: true })).toBeVisible()
  await expect(cat.dialog.getByLabel('Заметка', { exact: true })).toBeFocused()
  await expect(cat.dialog).toContainText('Не более 2000 символов')
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
  await cat.details()
  await cat.dialog.getByLabel('Действие с водой', { exact: true }).selectOption('replace')
  await cat.dialog.getByLabel('Налито, мл', { exact: true }).fill('250')
  await cat.dialog.getByLabel('Когда меняли / доливали', { exact: true }).fill('2026-09-27T12:00')
  await cat.save()
  await cat.dialog.locator('summary', { hasText: 'Вода и вес подробно' }).click()
  await expect(cat.dialog.getByTestId('cat-care-water-interval')).toHaveText('Нет оценки')
  await cat.dialog.getByRole('button', { name: 'Вода', exact: true }).click()
  await cat.details()
  await cat.dialog.getByLabel('Действие с водой', { exact: true }).selectOption('replace')
  await cat.dialog.getByLabel('Налито, мл', { exact: true }).fill('300')
  await cat.dialog.getByLabel('Осталось до замены / долива, мл', { exact: true }).fill('150')
  await cat.save()
  await cat.dialog.locator('summary', { hasText: 'Вода и вес подробно' }).click()
  await expect(cat.dialog.getByTestId('cat-care-water-interval').first()).toContainText('100')

  await cat.dialog.getByRole('button', { name: 'Вес', exact: true }).click()
  await cat.dialog.getByLabel('Вес, кг', { exact: true }).fill('4,2')
  await cat.details()
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
  await cat.dialog.getByRole('button', { name: 'Еда', exact: true }).click()
  await cat.dialog.getByLabel('Съедено, г', { exact: true }).fill('42')
  await cat.dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(cat.dialog.getByRole('alert')).toContainText('соединения')
  await expect(cat.dialog.getByLabel('Съедено, г', { exact: true })).toHaveValue('42')
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
  test.setTimeout(120_000)
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
      for (const name of ['Еда', 'Вода', 'Вес', 'Развернуть']) {
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
      for (const [name, field] of [
        ['Еда', 'Съедено, г'],
        ['Вода', 'Долито, мл'],
        ['Вес', 'Вес, кг'],
      ]) {
        await tile.getByRole('button', { name, exact: true }).click()
        await expect(cat.dialog).toHaveCount(1)
        await expect(cat.dialog.getByLabel(field!, { exact: true })).toBeVisible()
        await expect(
          cat.dialog.getByRole('button', { name: 'Сохранить', exact: true }),
        ).toHaveCount(1)
        await cat.dialog
          .getByRole('button', { name: 'Сохранить', exact: true })
          .click({ trial: true })
        await cat.dialog.getByRole('button', { name: 'Назад к дневнику', exact: true }).click()
        await cat.close()
      }
    })
  }
  expect(runtimeErrors).toEqual([])
})

test('real session identity owns new records, while another viewer cannot replace their creator', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const authenticator = await enableVirtualAuthenticator(page)
  const register = async (name: string) => {
    const { token } = await seedInvite(page.request, { label: 'cat-care-identity-e2e' })
    const activation = new ActivatePage(page)
    await activation.gotoActivate(token)
    await activation.fillName(name)
    await activation.submitRegister()
    await activation.waitForBoardRedirect()
    const response = await page.request.get('/api/auth/session')
    expect(response.ok()).toBe(true)
    return ((await response.json()) as { accountId: string }).accountId
  }
  const annaId = await register('Анна Тестовая')
  const cat = new CatCarePage(page)
  let instanceId = ''
  page.on('request', (request) => {
    if (request.url().endsWith(WRITE_PATH)) instanceId = request.postDataJSON().instanceId
  })
  await new HeaderPage(page).addWidget('Питание кошки')
  await cat.open()
  await cat.addProduct()
  await cat.feed()
  await cat.dialog.getByRole('button', { name: 'Вода', exact: true }).click()
  await cat.dialog.getByLabel('Долито, мл', { exact: true }).fill('80')
  await cat.save()
  await cat.dialog.getByRole('button', { name: 'Вес', exact: true }).click()
  await cat.dialog.getByLabel('Вес, кг', { exact: true }).fill('4,2')
  await cat.save()
  const authors = cat.dialog.getByTestId('cat-care-record-author')
  await expect(authors).toHaveCount(3)
  for (const row of await authors.all())
    await expect(row.locator(':scope > span').last()).toHaveText('Анна Тестовая · вы')
  const before = test.info().outputPath('record-authors.png')
  await cat.dialog.screenshot({ path: before })
  await test.info().attach('record-authors', { path: before, contentType: 'image/png' })
  await cat.close()
  // Registration excludes existing credentials: Boris owns a different passkey.
  await authenticator.client.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: authenticator.authenticatorId,
  })
  await authenticator.client.detach()
  await enableVirtualAuthenticator(page)
  const borisId = await register('Борис Тестовый')
  expect(borisId).not.toBe(annaId)
  await cat.open()
  await page.route(`**${WRITE_PATH}`, async (route) => {
    const body = route.request().postDataJSON()
    body.payload.createdBy = { accountId: annaId, name: 'Поддельный автор' }
    await route.continue({ postData: JSON.stringify(body) })
  })
  await cat.dialog
    .getByTestId('cat-care-food-record')
    .getByRole('button', { name: /Изменить/ })
    .click()
  await cat.dialog.getByLabel('Съедено, г', { exact: true }).fill('25')
  await cat.save()
  await expect(cat.eaten).toHaveText('100')
  await expect(
    cat.dialog
      .getByTestId('cat-care-food-record')
      .getByTestId('cat-care-record-author')
      .locator(':scope > span')
      .last(),
  ).toHaveText('Анна Тестовая')
  const response = await page.request.get(
    `/api/storage/${encodeURIComponent(`w:i:${instanceId}:ledger`)}`,
  )
  expect(response.ok()).toBe(true)
  const body = await response.json()
  const ledger = (Array.isArray(body) ? body : body.value) as Array<{
    command: { kind: string }
    createdBy: { accountId: string; name: string } | null
  }>
  const meals = ledger.filter((entry) => entry.command.kind === 'food.save')
  expect(meals.map((entry) => entry.createdBy)).toEqual([
    { accountId: annaId, name: 'Анна Тестовая' },
    { accountId: borisId, name: 'Борис Тестовый' },
  ])
  await page.reload()
  await cat.open()
  await expect(
    cat.dialog
      .getByTestId('cat-care-food-record')
      .getByTestId('cat-care-record-author')
      .locator(':scope > span')
      .last(),
  ).toHaveText('Анна Тестовая')
  await cat.dialog.screenshot({ path: test.info().outputPath('identity-original-creator.png') })
})
