import { expect, test } from '@playwright/test'

import { postWeightReading, type WeightReading, WeightPage } from './pages/WeightPage.js'
import { seedSession } from './support/gate.js'

const HOUR = 3_600_000

test.beforeEach(async ({ request }) => {
  await request.post('/api/test/reset')
  // Other specs pin the process-wide server clock; the card filters its 30-day period by the
  // browser's own clock, so put the server back on real time.
  await request.post('/api/test/time', { data: { ms: Date.now() } })
})

test('weight card updates live from seeded health readings, once per reading and per account', async ({
  page,
  playwright,
  baseURL,
}) => {
  // page.request shares the browser context's cookies: this session is the board's account.
  await seedSession(page.request)
  await page.goto('/')

  const weight = new WeightPage(page)
  await weight.addWeightWidget()
  await expect(weight.card.emptyTitle).toBeVisible()

  // Every reading is a few hours old, so all of them fall in the default 30-day period.
  const now = Date.now()
  const first: WeightReading = { id: 'e2e-hardware:1:first', takenAt: now - 3 * HOUR, kg: 83.0 }
  await postWeightReading(page.request, first)

  // No reload: the ingest's storage write has to reach the card over the live stream.
  await expect(weight.card.value).toHaveText('83,0 кг')

  // The board card's default size is the tiny tier, which cannot tell one point from two; the
  // fullscreen view can — the single-reading hole, no delta, one row — and stays open, live,
  // for the rest of the test.
  await weight.openFullscreen()
  await expect(weight.fullscreen.value).toHaveText('83,0 кг')
  await expect(weight.fullscreen.singleHint).toBeVisible()
  await expect(weight.fullscreen.delta).toHaveCount(0)
  await expect(weight.fullscreen.rows).toHaveCount(1)

  // The same reading again is the same reading: still exactly one point.
  await postWeightReading(page.request, first)

  // A second account's reading — newer and heavier, so a leak would replace the latest value.
  const other = await playwright.request.newContext({ baseURL })
  try {
    await seedSession(other)
    await postWeightReading(other, {
      id: 'e2e-hardware:1:other-account',
      takenAt: now - HOUR,
      kg: 95.5,
    })
  } finally {
    await other.dispose()
  }

  // A sentinel reading of this account, older than the other account's: once it shows up, every
  // write above has been fanned out too. The card then holds exactly two points — the duplicate
  // did not add one, and the other account's reading neither became the latest nor joined the
  // series.
  await postWeightReading(page.request, {
    id: 'e2e-hardware:1:second',
    takenAt: now - 2 * HOUR,
    kg: 82.4,
  })
  await expect(weight.fullscreen.value).toHaveText('82,4 кг')
  await expect(weight.fullscreen.delta).toHaveText('−0,6 кг за 30 дней')
  await expect(weight.fullscreen.singleHint).toHaveCount(0)
  await expect(weight.fullscreen.rows).toHaveCount(2)
  await expect(weight.fullscreen.rows.nth(0)).toContainText('82,4 кг')
  await expect(weight.fullscreen.rows.nth(1)).toContainText('83,0 кг')
})
