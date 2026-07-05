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

  // All balances are 0 before any action, so DebtChips renders the plain-text
  // "even" summary rather than per-person chips (see DebtChips.tsx's allZero
  // branch) — assert on that summary instead of a chip that doesn't exist yet.
  await expect(ofelia.card.getByText('баланс ровный')).toBeVisible()

  await ofelia.debtButton.click()

  await expect(ofelia.debtChip(ON_DUTY)).toContainText('1')
  await expect(ofelia.confirmedPlaque).toBeVisible()
})

test('Простить — decrements an existing debt', async ({ page, request }) => {
  const DEBTOR = 'Карина' as const

  // Seed a past debt for Карина (not on duty on the pinned date, 2026-06-16 is
  // a Леша-duty day) so getDebtDays can assign today as her forgive-day —
  // getDebtDays never assigns a person's own duty day as their forgive-day, so
  // the debt must belong to whoever is NOT on duty today. 2026-06-15 is a
  // genuine Карина duty day, so this reads as "Леша covered for Карина who
  // owed 2026-06-15". The global balance shows Карина:1 while today
  // (2026-06-16) stays pending — the secondary row, and thus "Простить", only
  // renders while status is pending.
  await request.put(LEDGER_URL, {
    data: {
      value: [
        {
          id: 'seed-1',
          ts: 1,
          ip: '127.0.0.1',
          date: '2026-06-15',
          type: 'went_into_debt',
          actor: 'Леша',
          onBehalfOf: 'Карина',
          by: 'Леша',
        },
      ],
    },
  })

  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await expect(ofelia.debtChip(DEBTOR)).toContainText('1')
  await expect(ofelia.forgiveButton).toBeVisible()

  await ofelia.forgiveButton.click()

  // Forgiving Карина's only debt brings the global balance back to 0:0, so
  // DebtChips renders the plain-text "even" summary (see DebtChips.tsx's
  // allZero branch) instead of a per-person chip — assert on that summary
  // rather than a chip that no longer exists.
  await expect(ofelia.card.getByText('баланс ровный')).toBeVisible()
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
