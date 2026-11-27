import { expect, test } from '@playwright/test'
import { catWeightKey } from 'module-cats/domain/keys'

import { seedCats } from './pages/cats-seed.js'
import { CatsPage } from './pages/CatsPage.js'

// Noon Europe/Warsaw (UTC+1 in November) → server "today" = 2026-11-26.
const PINNED_ISO = '2026-11-26T12:00:00+01:00'
const TODAY = '2026-11-26'

const OFELIA = { id: 'ofelia', name: 'Офелия', litterId: 'ofelia' }

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
