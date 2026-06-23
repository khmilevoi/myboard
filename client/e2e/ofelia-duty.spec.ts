import { expect, test } from '@playwright/test'

import { OfeliaPage } from './pages/OfeliaPage.js'

// Noon Europe/Warsaw (UTC+2 in June) → server "today" = 2026-06-16.
// getOfeliaDutyByDate(2026-06-16) → Леша (diffDays 0 from BASE_DUTY_DATE, even).
const PINNED_ISO = '2026-06-16T12:00:00+02:00'
const ON_DUTY = 'Леша' as const
const LEDGER_URL = `/api/storage/${encodeURIComponent('w:t:ofelia-poop-duty:ledger')}`

test.beforeEach(async ({ request }) => {
  await request.post('/api/test/reset')
  await request.post('/api/test/time', { data: { iso: PINNED_ISO } })
})

test('render — shows today’s duty person and the pending primary action', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await expect(ofelia.dutyName).toHaveText(ON_DUTY)
  await expect(ofelia.confirmButton).toBeVisible()
})

test('confirm — flips to the confirmed plaque via the SSE round-trip', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await ofelia.confirmButton.click()

  await expect(ofelia.confirmedPlaque).toBeVisible()
  await expect(ofelia.undoButton).toBeVisible()
  await expect(ofelia.confirmButton).toHaveCount(0)
})

test('undo — returns the day to pending', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await ofelia.confirmButton.click()
  await expect(ofelia.confirmedPlaque).toBeVisible()

  await ofelia.undoButton.click()

  await expect(ofelia.confirmButton).toBeVisible()
  await expect(ofelia.confirmedPlaque).toHaveCount(0)
})

test('В долг — increments the on-duty person’s debt chip and closes the day', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await expect(ofelia.debtChip(ON_DUTY)).toContainText('0')

  await ofelia.debtButton.click()

  await expect(ofelia.debtChip(ON_DUTY)).toContainText('1')
  await expect(ofelia.confirmedPlaque).toBeVisible()
})

test('Простить — decrements an existing debt', async ({ page, request }) => {
  // Seed a past debt (Леша went into debt on 2026-06-14, a Леша-duty day) so the
  // global balance shows Леша:1 while today (2026-06-16) stays pending — the
  // secondary row, and thus "Простить", only renders while status is pending.
  await request.put(LEDGER_URL, {
    data: {
      value: [
        {
          id: 'seed-1',
          ts: 1,
          ip: '127.0.0.1',
          date: '2026-06-14',
          type: 'went_into_debt',
          actor: 'Карина',
          onBehalfOf: 'Леша',
          by: 'Карина',
        },
      ],
    },
  })

  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await expect(ofelia.debtChip(ON_DUTY)).toContainText('1')
  await expect(ofelia.forgiveButton).toBeVisible()

  await ofelia.forgiveButton.click()

  await expect(ofelia.debtChip(ON_DUTY)).toContainText('0')
})

test('persistence — a confirmed day survives a reload', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await ofelia.confirmButton.click()
  await expect(ofelia.confirmedPlaque).toBeVisible()

  await page.reload()
  await expect(ofelia.dutyName).toBeVisible()
  await expect(ofelia.confirmedPlaque).toBeVisible()
})
