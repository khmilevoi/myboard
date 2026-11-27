import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { catWeightKey } from 'module-cats/domain/keys'

import { BoardPage } from './pages/BoardPage.js'
import { seedCats } from './pages/cats-seed.js'
import { CatsPage } from './pages/CatsPage.js'
import { HeaderPage } from './pages/HeaderPage.js'

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

  // The "Вес" tab of the fullscreen lists that one weighing.
  await cats.openFullscreen()
  await cats.tab('Вес').click()
  const rows = cats.overlay.getByRole('list', { name: 'Все взвешивания' }).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('4,30')
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

// The "Все кошки" tab and the card switchers around it. A `w:4` card is ~458 px wide at this
// viewport, which is the standard tier for both the "Кошки" and the "Лоток" card (the litter
// switcher is a button from the standard tier up; the compact tier shows a badge).
test.describe('all cats', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  const MANAGE = 'Управлять кошками →'
  const SWITCHER = /^Выбрать лоток/
  const CAT_SWITCHER = /^Выбрать кошку/

  function locators(page: Page) {
    const board = new BoardPage(page)
    return {
      board,
      header: new HeaderPage(page),
      // The passport is the only card with a "Взвесить" button; a litter card's title carries "Лоток ·".
      catsCard: board.widgetCards.filter({
        has: page.getByRole('button', { name: 'Взвесить', exact: true }),
      }),
      litterCard: board.widgetCards.filter({ hasText: 'Лоток ·' }),
      overlay: page.getByRole('dialog', { name: 'Кошки' }),
    }
  }

  async function expand(card: Locator): Promise<void> {
    await card.hover()
    await card.getByRole('button', { name: 'Развернуть' }).click()
  }

  async function closeOverlay(overlay: Locator): Promise<void> {
    await overlay.getByRole('button', { name: 'Закрыть' }).click()
    await expect(overlay).toHaveCount(0)
  }

  async function openAllTab(overlay: Locator): Promise<void> {
    await expect(overlay).toBeVisible()
    await overlay
      .getByRole('group', { name: 'Разделы' })
      .getByRole('button', { name: 'Все кошки' })
      .click()
  }

  /** The instance-scope choice keys of every card, as stored: `card/cat` or `card/litter`. */
  async function storedChoices(request: APIRequestContext, suffix: string): Promise<unknown[]> {
    const keys = await request.get(`/api/storage?prefix=${encodeURIComponent('w:i:')}`)
    const listed = ((await keys.json()) as { keys: string[] }).keys.filter((key) =>
      key.endsWith(`:${suffix}`),
    )
    return await Promise.all(
      listed.map(async (key) => {
        const response = await request.get(`/api/storage/${encodeURIComponent(key)}`)
        return ((await response.json()) as { value: unknown }).value
      }),
    )
  }

  test('add and archive — the card choices follow the cat, and nothing is written back', async ({
    page,
    request,
  }) => {
    const { header, board, catsCard, litterCard, overlay } = locators(page)
    await page.goto('/')
    await header.addWidget('Кошки')
    await header.addWidget('Лоток')
    await expect(board.widgetCards).toHaveCount(2)
    await expect(catsCard.getByRole('heading', { name: 'Офелия' })).toBeVisible()
    await expect(litterCard.getByRole('heading', { name: 'Лоток · Офелия' })).toBeVisible()

    // Add "Буся" with a litter of her own, from the "Все кошки" tab.
    await expand(catsCard)
    await openAllTab(overlay)
    await overlay.getByRole('button', { name: 'Добавить кошку' }).click()
    const form = page.getByRole('dialog', { name: 'Новая кошка' })
    await expect(form).toBeVisible()
    await form.getByLabel('Имя').fill('Буся')
    await expect(form.getByRole('radio', { name: /Свой лоток/ })).toBeChecked()
    await form.getByRole('button', { name: 'Добавить кошку' }).click()
    await expect(form).toHaveCount(0)
    // The new cat is chosen and her profile opens, over the still open fullscreen.
    await expect(overlay).toBeVisible()
    await expect(overlay.getByLabel('Имя')).toHaveValue('Буся')
    await closeOverlay(overlay)
    await expect.poll(async () => (await storedChoices(request, 'card/cat')).length).toBe(1)
    const [busyaCat] = await storedChoices(request, 'card/cat')

    // The standard card switcher now offers both cats.
    await expect(catsCard.getByRole('heading', { name: 'Буся' })).toBeVisible()
    await catsCard.getByRole('button', { name: CAT_SWITCHER }).click()
    const catMenu = page.getByRole('menu', { name: 'Кошки' })
    await expect(catMenu.getByRole('menuitemradio', { name: 'Офелия' })).toBeVisible()
    await expect(catMenu.getByRole('menuitemradio', { name: 'Буся' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(catMenu).toHaveCount(0)

    // A placed "Лоток" card now offers "Лоток · Буся", and keeps it once chosen.
    await litterCard.getByRole('button', { name: SWITCHER }).click()
    await page.getByRole('menuitemradio', { name: 'Лоток · Буся' }).click()
    await expect(litterCard.getByRole('heading', { name: 'Лоток · Буся' })).toBeVisible()
    // The server named her litter; the card stores that id.
    await expect.poll(async () => (await storedChoices(request, 'card/litter')).length).toBe(1)
    const [busyaLitter] = await storedChoices(request, 'card/litter')
    expect(busyaLitter).toEqual(expect.any(String))
    expect(busyaLitter).not.toBe('ofelia')

    // Archive "Буся": the cards that had chosen her show the first active option instead, and
    // their stored choice stays what it was.
    await expand(catsCard)
    await openAllTab(overlay)
    const rows = overlay.getByRole('list', { name: 'Кошки на борде' }).getByRole('listitem')
    await expect(rows).toHaveCount(2)
    await rows.filter({ hasText: 'Буся' }).getByRole('button', { name: 'В архив' }).click()
    const confirm = page.getByRole('dialog', { name: 'Убрать Бусю в архив?' })
    await expect(confirm).toContainText('Карточки, где была выбрана она, покажут Офелию.')
    await expect(confirm).toContainText(
      'Лоток · Буся больше никому не нужен: ночные отметки по нему остановятся.',
    )
    await confirm.getByRole('button', { name: 'В архив' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(overlay).toBeVisible()
    await expect(rows).toHaveCount(1)
    await expect(overlay.getByText('В архиве · 1')).toBeVisible()
    await closeOverlay(overlay)

    await expect(litterCard.getByRole('heading', { name: 'Лоток · Офелия' })).toBeVisible()
    await expect(catsCard.getByRole('heading', { name: 'Офелия' })).toBeVisible()
    expect(await storedChoices(request, 'card/litter')).toEqual([busyaLitter])
    expect(await storedChoices(request, 'card/cat')).toEqual([busyaCat])

    // Restore her: the stored choices come back to life.
    await expand(catsCard)
    await openAllTab(overlay)
    await overlay.getByText('В архиве · 1').click()
    await overlay.getByRole('button', { name: 'Вернуть' }).click()
    await expect(rows).toHaveCount(2)
    await closeOverlay(overlay)

    await expect(litterCard.getByRole('heading', { name: 'Лоток · Буся' })).toBeVisible()
    await expect(catsCard.getByRole('heading', { name: 'Буся' })).toBeVisible()
    expect(await storedChoices(request, 'card/litter')).toEqual([busyaLitter])
    expect(await storedChoices(request, 'card/cat')).toEqual([busyaCat])
  })

  test('the last active cat cannot be archived', async ({ page }) => {
    const { header, catsCard, overlay } = locators(page)
    await page.goto('/')
    await header.addWidget('Кошки')
    await expect(catsCard.getByRole('heading', { name: 'Офелия' })).toBeVisible()

    await expand(catsCard)
    await openAllTab(overlay)
    const archive = overlay.getByRole('button', { name: 'В архив' })
    await expect(archive).toHaveAttribute('aria-disabled', 'true')
    await expect(
      overlay.getByText(
        'Последнюю кошку в архив не убрать — на борде всегда есть кого показывать.',
      ),
    ).toBeVisible()
    // Playwright treats aria-disabled as not actionable: force the click a user could still make.
    await archive.click({ force: true })
    await expect(page.getByRole('dialog', { name: /^Убрать/ })).toHaveCount(0)
  })

  // Review Focus (Task 6): "Управлять кошками →" opens a placed "Кошки" card and it stays open.
  // A dropOverlay history.back() racing the host's fullscreen push is the risk, so each case
  // waits a moment and looks again.
  test.describe('manage link', () => {
    test.beforeEach(async ({ request }) => {
      await seedCats(request, [OFELIA, BUSYA])
    })

    test('from a litter card on the board — the "Кошки" fullscreen opens and stays', async ({
      page,
    }) => {
      const { header, board, litterCard, overlay } = locators(page)
      await page.goto('/')
      await header.addWidget('Кошки')
      await header.addWidget('Лоток')
      await expect(board.widgetCards).toHaveCount(2)

      await litterCard.getByRole('button', { name: SWITCHER }).click()
      await page.getByRole('menuitem', { name: MANAGE }).click()

      await expect(overlay).toBeVisible()
      await expect(overlay.getByRole('group', { name: 'Разделы' })).toBeVisible()
      await page.waitForTimeout(400)
      await expect(overlay).toBeVisible()
      await expect(page.getByRole('menu')).toHaveCount(0)

      await closeOverlay(overlay)
      await expect(litterCard.getByRole('heading', { name: 'Лоток · Офелия' })).toBeVisible()
    })

    test('from a litter card in fullscreen — the "Кошки" fullscreen replaces it and stays', async ({
      page,
    }) => {
      const { header, board, litterCard, overlay } = locators(page)
      await page.goto('/')
      await header.addWidget('Кошки')
      await header.addWidget('Лоток')
      await expect(board.widgetCards).toHaveCount(2)

      await expand(litterCard)
      const litterOverlay = page.getByRole('dialog', { name: 'Лоток' })
      await expect(litterOverlay).toBeVisible()
      await litterOverlay.getByRole('button', { name: SWITCHER }).click()
      await page.getByRole('menuitem', { name: MANAGE }).click()

      await expect(overlay).toBeVisible()
      await expect(overlay.getByRole('group', { name: 'Разделы' })).toBeVisible()
      await page.waitForTimeout(400)
      await expect(overlay).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(1)
      await expect(page.getByRole('menu')).toHaveCount(0)

      await closeOverlay(overlay)
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    test('with no "Кошки" card — the menu shows the hint instead of the link', async ({ page }) => {
      const { header, litterCard } = locators(page)
      await page.goto('/')
      await header.addWidget('Лоток')
      await expect(litterCard.getByRole('heading', { name: 'Лоток · Офелия' })).toBeVisible()

      await litterCard.getByRole('button', { name: SWITCHER }).click()

      await expect(page.getByRole('menu', { name: 'Лотки' })).toContainText(
        'Добавить или изменить кошку — в виджете «Кошки». Поставьте его на борду из каталога.',
      )
      await expect(page.getByRole('menuitem', { name: MANAGE })).toHaveCount(0)
    })
  })
})
