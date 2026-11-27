import { catGoalKey, catProfileKey, catWeightKey } from 'module-cats/domain/keys'

import { seedCats } from './pages/cats-seed.js'
import { CatsPage } from './pages/CatsPage.js'
import { expect, test, type APIRequestContext, type Locator } from './support/test.js'

// The repository owner's phone: 360 × 728 CSS px at a device pixel ratio of ~3.5. Every earlier
// phone check ran at 390 × 844, where the board's single column is wide enough for the standard
// tier; at 360 it is ~300 px, the compact tier, and the fullscreen dialog is ~330 px wide.
test.use({
  viewport: { width: 360, height: 728 },
  deviceScaleFactor: 3.5,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
})

const OFELIA = { id: 'ofelia', name: 'Офелия', litterId: 'ofelia' }

async function put(request: APIRequestContext, key: string, value: unknown): Promise<void> {
  const response = await request.put(
    `/api/storage/scoped/module/cats/shared/${encodeURIComponent(key)}`,
    { headers: { 'X-Requested-With': 'MyBoard' }, data: { value } },
  )
  if (!response.ok()) throw new Error(`seeding ${key} failed with status ${response.status()}`)
}

/** Ofelia as the owner's board has her: a full profile, weighed or not. */
async function seedOfelia(request: APIRequestContext, weighed: boolean): Promise<void> {
  await seedCats(request, [OFELIA])
  await put(request, catProfileKey('ofelia'), {
    name: 'Офелия',
    breed: 'Британская',
    birthDate: '2024-11-14',
    sex: 'female',
    sterilized: 'yes',
    bodyCondition: 5,
    avatar: null,
    litterId: 'ofelia',
  })
  if (!weighed) return
  await put(request, catWeightKey('ofelia'), [
    { id: 'w1', ts: 1, at: '2026-09-01', kg: 4.44 },
    { id: 'w2', ts: 2, at: '2026-11-21', kg: 4.32 },
  ])
  await put(request, catGoalKey('ofelia'), [{ id: 'g1', ts: 1, kcal: 240, since: '2026-11-01' }])
}

/** Every rendered element of `root` that pokes out past its right or left edge. */
async function overflowing(root: Locator): Promise<string[]> {
  return await root.evaluate((element) => {
    const edge = element.getBoundingClientRect()
    return Array.from(element.querySelectorAll<HTMLElement>('*'))
      .filter((child) => {
        const box = child.getBoundingClientRect()
        if (box.width <= 1 || box.height <= 1) return false
        return box.right > edge.right + 0.5 || box.left < edge.left - 0.5
      })
      .map((child) => `${child.tagName} "${(child.textContent ?? '').trim().slice(0, 40)}"`)
  })
}

/** How many lines the text of `element` is laid out on: one client rect per line box. */
async function lines(element: Locator): Promise<number> {
  return await element.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const tops = Array.from(range.getClientRects(), (rect) => Math.round(rect.top))
    return new Set(tops).size
  })
}

/** Every option of a segmented choice on the same row. */
async function expectOneRow(group: Locator): Promise<void> {
  const items = await group.getByRole('radio').all()
  expect(items.length).toBeGreaterThan(1)
  const tops = await Promise.all(items.map(async (item) => (await item.boundingBox())?.y))
  expect(new Set(tops.map((top) => Math.round(top ?? -1))).size).toBe(1)
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/test/reset')
  await request.post('/api/test/time', { data: { iso: '2026-11-26T12:00:00+01:00' } })
})

test('the board card, never weighed — the compact tier offers "Взвесить" and "Профиль"', async ({
  page,
  request,
}) => {
  await seedOfelia(request, false)
  const cats = new CatsPage(page)
  await cats.addWidget()

  await cats.expectTier('compact')
  await expect(cats.heading('Офелия')).toBeVisible()
  await expect(cats.weighButton).toBeInViewport()
  await expect(cats.card.getByRole('button', { name: 'Профиль' })).toBeVisible()
  expect(await overflowing(cats.card)).toEqual([])
})

test('the board card, weighed — the weight, the facts and the quick actions', async ({
  page,
  request,
}) => {
  await seedOfelia(request, true)
  const cats = new CatsPage(page)
  await cats.addWidget()

  await cats.expectTier('compact')
  await expect(cats.card).toContainText('4,32 кг')
  await expect(cats.card.getByText('кошка · стерилизована')).toBeVisible()
  await expect(cats.card.getByText('5 / 9')).toBeVisible()
  await expect(cats.weighButton).toBeVisible()
  expect(await overflowing(cats.card)).toEqual([])

  await cats.weigh('4,30')
  await expect(cats.card).toContainText('4,30 кг')
})

test('fullscreen — no tab scrolls sideways, and the profile choices sit on one row', async ({
  page,
  request,
}) => {
  await seedOfelia(request, true)
  const cats = new CatsPage(page)
  await cats.addWidget()
  await cats.card.getByRole('button', { name: 'Развернуть' }).click()
  await expect(cats.overlay).toBeVisible()
  const profile = cats.overlay.getByRole('region', { name: 'О кошке' })
  await expect(profile).toBeVisible()

  expect(await overflowing(cats.overlay)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360)
  await expectOneRow(cats.overlay.getByRole('radiogroup', { name: 'Пол' }))
  await expectOneRow(cats.overlay.getByRole('radiogroup', { name: 'Стерилизована' }))
  await expectOneRow(cats.overlay.getByRole('radiogroup', { name: 'Упитанность' }))
  expect(await lines(cats.overlay.getByText('Все изменения сохранены'))).toBe(1)

  await cats.overlay.getByLabel('Порода').fill('Британская короткошёрстная')
  // The longer status may take two lines, but on a row of its own, above the buttons.
  const dirty = cats.overlay.getByText('Изменения не сохранены · цель сохраняется отдельно')
  const statusBox = await dirty.boundingBox()
  const cancelBox = await cats.overlay.getByRole('button', { name: 'Отменить' }).boundingBox()
  expect(statusBox && cancelBox && statusBox.y + statusBox.height <= cancelBox.y).toBe(true)
  expect(await overflowing(cats.overlay)).toEqual([])

  for (const tab of ['Вес', 'Все кошки']) {
    await cats.tab(tab).click()
    await expect(cats.tab(tab)).toHaveAttribute('aria-pressed', 'true')
    expect(await overflowing(cats.overlay)).toEqual([])
  }
  expect(await lines(cats.overlay.getByText('Кошки на борде · 1'))).toBe(1)
  expect(await lines(cats.overlay.getByRole('button', { name: 'Добавить кошку' }))).toBe(1)
})
