import { BoardPage } from './pages/BoardPage.js'
import { seedCats, seedLedger } from './pages/cats-seed.js'
import { OfeliaPage } from './pages/OfeliaPage.js'
import { OfeliaStatsPage } from './pages/OfeliaStatsPage.js'
import { expect, test } from './support/test.js'

// Same pinned clock as ofelia-duty.spec.ts: noon Europe/Warsaw on 2026-06-16,
// a Леша duty day.
const PINNED_ISO = '2026-06-16T12:00:00+02:00'
const ON_DUTY = 'Леша' as const

// Same viewport as ofelia-duty.spec.ts, for the same reason: the duty card's
// "Какашки убраны" button lives in its standard tier, which needs a 400px frame.
test.use({ viewport: { width: 1920, height: 1080 } })

test.beforeEach(async ({ request }) => {
  await request.post('/api/test/reset')
  await request.post('/api/test/time', { data: { iso: PINNED_ISO } })
  await seedCats(request, [{ id: 'ofelia', name: 'Офелия', litterId: 'ofelia' }])
})

test('one ofelia module model — a cleaning in the duty card reaches the stats card live', async ({
  page,
}) => {
  const duty = new OfeliaPage(page)
  await duty.seedOfeliaWidget()

  const stats = new OfeliaStatsPage(page)
  await stats.addStatsWidget()

  await expect(stats.cleanings(ON_DUTY)).toHaveText('0')
  await expect(stats.debt(ON_DUTY)).toHaveText('0')

  // A new widget lands first on the board, so OfeliaPage's index-0 card is the
  // stats card by now; find the duty card by the content only it renders.
  const dutyCard = new BoardPage(page).widgetCards.filter({
    has: page.getByTestId('ofelia-duty-person'),
  })
  await dutyCard.getByRole('button', { name: 'Какашки убраны' }).click()
  await expect(dutyCard.getByText('Уборка подтверждена')).toBeVisible()

  // No reload: both widgets read the one module model, so the duty card's
  // write has to show up in the stats card on its own.
  await expect(stats.cleanings(ON_DUTY)).toHaveText('1')
  await expect(stats.debt(ON_DUTY)).toHaveText('0')
})

test('the stats card is "Статистика лотка" and its numbers follow the chosen litter', async ({
  page,
  request,
}) => {
  await seedCats(request, [
    { id: 'ofelia', name: 'Офелия', litterId: 'ofelia' },
    { id: 'busya', name: 'Буся', litterId: 'busya' },
  ])
  await seedLedger(request, 'busya', [
    { id: 'seed-busya', ts: 1, date: '2026-06-16', type: 'cleaned', actor: 'Карина', by: 'Карина' },
  ])
  await page.goto('/')
  const stats = new OfeliaStatsPage(page)
  await stats.addStatsWidget()

  await expect(stats.card.getByRole('heading', { name: 'Лоток · Офелия' })).toBeVisible()
  await expect(stats.cleanings('Карина')).toHaveText('0')

  await stats.card.getByRole('button', { name: 'Выбрать лоток · сейчас Лоток · Офелия' }).click()
  await page.getByRole('menuitemradio', { name: 'Лоток · Буся' }).click()

  await expect(stats.card.getByRole('heading', { name: 'Лоток · Буся' })).toBeVisible()
  await expect(stats.cleanings('Карина')).toHaveText('1')
  await expect(stats.cleanings('Леша')).toHaveText('0')
})
