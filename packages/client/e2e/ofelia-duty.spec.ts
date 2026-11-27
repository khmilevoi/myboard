import { expect, test } from '@playwright/test'

import { BoardPage } from './pages/BoardPage.js'
import { seedCats, seedLedger } from './pages/cats-seed.js'
import { HeaderPage } from './pages/HeaderPage.js'
import { OfeliaPage } from './pages/OfeliaPage.js'

// Noon Europe/Warsaw (UTC+2 in June) → server "today" = 2026-06-16.
// getOfeliaDutyByDate(2026-06-16) → Леша (diffDays 0 from BASE_DUTY_DATE, even).
const PINNED_ISO = '2026-06-16T12:00:00+02:00'
const ON_DUTY = 'Леша' as const

const OFELIA = { id: 'ofelia', name: 'Офелия', litterId: 'ofelia' }
const BUSYA = { id: 'busya', name: 'Буся', litterId: 'busya' }

// Every assertion here is StandardTier UI — `ofelia-duty-person` exists only in
// ui/tiers/StandardTier.tsx — and this widget only resolves `standard` once its
// frame is at least 400px wide (`tiers.standard.minWidthPx`). So the width is a
// precondition of what is being asserted, and the spec has to declare it.
//
// Playwright's default 1280 viewport is ~7px short of it. The board measures its
// own container, not the window: 1280 minus the stable scrollbar gutter and the
// board's 20px padding on each side leaves 1225px, so at 12 columns a default
// `w:4` card is ~395px and its frame ~393px once the card's 1px border is taken
// off. `compact` is then the correct rendering, not a defect. (This used to be
// invisible: the board reported a hardcoded 1280px container on every screen,
// which made the card 413px — a 411px frame, only 11px of headroom — against a
// measurement that was wrong by 55px.)
//
// At 1920 the container is ~1865px, the card ~608px and the frame ~606px, well
// clear of the threshold.
test.use({ viewport: { width: 1920, height: 1080 } })

test.beforeEach(async ({ request }) => {
  await request.post('/api/test/reset')
  await request.post('/api/test/time', { data: { iso: PINNED_ISO } })
  // The e2e stack starts with an empty registry (no migration), and a litter card shows its empty
  // state until a cat points at a litter: register Ofelia on her litter the way `ofelia-to-cats`
  // seeds production.
  await seedCats(request, [OFELIA])
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
  await seedLedger(request, 'ofelia', [
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
  ])

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

test('a confirmed day is written through the ofelia module action', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  const request = page.waitForRequest((candidate) =>
    candidate.url().includes('/api/modules/cats/actions/clean'),
  )
  await ofelia.confirmButton.click()
  await request

  await expect(ofelia.confirmedPlaque).toBeVisible()
})

test('auto-approve — a cron-closed day reaches the open board over SSE', async ({
  page,
  request,
}) => {
  // The job returns early on an empty ledger on purpose: a stack where nobody
  // has ever used the widget must not grow one fabricated `cleaned` record a
  // night forever (server.ts, F11, added in b1fffc0e — six hours after this
  // test was written, which is why it started failing). So the board needs
  // some history before the cron has anything to close.
  //
  // 2026-06-15 is a genuine Карина duty day and this entry closes it, so the
  // run below skips it and 2026-06-16 — the day the card is showing — is the
  // one that gets auto-approved. Do not drop this seed to "simplify" the
  // test: without it the cron no-ops and every assertion below fails.
  // The cron closes only litters an active cat points at: the `beforeEach` seed registers cat
  // `ofelia` on litter `ofelia`.
  await seedLedger(request, 'ofelia', [
    {
      id: 'seed-history',
      ts: 1,
      date: '2026-06-15',
      type: 'cleaned',
      actor: 'Карина',
      by: 'Карина',
    },
  ])

  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()
  await expect(ofelia.confirmButton).toBeVisible()

  // The first tick only seeds the job cursor — nothing may change yet.
  await request.post('/api/test/cron/tick')
  await expect(ofelia.confirmButton).toBeVisible()

  // Past the next 00:05 Warsaw, so the 2026-06-17 occurrence is due and closes
  // every unresolved day up to and including 2026-06-16.
  await request.post('/api/test/time', { data: { iso: '2026-06-17T00:06:00+02:00' } })
  await request.post('/api/test/cron/tick')

  // No reload: this must arrive through the storage SSE stream. Same assertion
  // pair the manual "confirm" test uses, so a pass means the cron write is
  // indistinguishable from a button press as far as the board is concerned.
  await expect(ofelia.confirmedPlaque).toBeVisible()
  await expect(ofelia.undoButton).toBeVisible()
  await expect(ofelia.confirmButton).toHaveCount(0)
})

const SWITCHER = /^Выбрать лоток/

test('one litter — the card is titled by it and offers no switcher anywhere', async ({ page }) => {
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await expect(ofelia.card.getByRole('heading', { name: 'Лоток · Офелия' })).toBeVisible()
  await expect(ofelia.card.getByRole('button', { name: SWITCHER })).toHaveCount(0)

  await new BoardPage(page).expandCard(0)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Лоток · Офелия' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: SWITCHER })).toHaveCount(0)
})

test('two cards, two litters — each card keeps its own litter', async ({ page, request }) => {
  await seedCats(request, [OFELIA, BUSYA])
  await page.goto('/')
  const header = new HeaderPage(page)
  const board = new BoardPage(page)
  await header.addWidget('Лоток')
  await header.addWidget('Лоток')
  await expect(board.widgetCards).toHaveCount(2)
  const first = board.getCard(0)
  const second = board.getCard(1)
  await expect(first.getByRole('heading', { name: 'Лоток · Офелия' })).toBeVisible()
  await expect(second.getByRole('heading', { name: 'Лоток · Офелия' })).toBeVisible()

  // The choice goes to the second card's own instance scope: read its id off the write.
  const write = page.waitForRequest(
    (candidate) =>
      candidate.method() === 'PUT' &&
      /^w:i:.+:card\/litter$/.test(
        decodeURIComponent(new URL(candidate.url()).pathname.split('/').pop() ?? ''),
      ),
  )
  await second.getByRole('button', { name: 'Выбрать лоток · сейчас Лоток · Офелия' }).click()
  await page.getByRole('menuitemradio', { name: 'Лоток · Буся' }).click()
  const key = decodeURIComponent(new URL((await write).url()).pathname.split('/').pop() ?? '')
  await expect(second.getByRole('heading', { name: 'Лоток · Буся' })).toBeVisible()

  await page.reload()
  await expect(board.getCard(0).getByRole('heading', { name: 'Лоток · Офелия' })).toBeVisible()
  await expect(board.getCard(1).getByRole('heading', { name: 'Лоток · Буся' })).toBeVisible()

  const secondId = /^w:i:(.+):card\/litter$/.exec(key)?.[1]
  expect(secondId).toBeTruthy()
  const stored = await request.get(
    `/api/storage/${encodeURIComponent(`w:i:${secondId}:card/litter`)}`,
  )
  expect(stored.ok()).toBe(true)
  expect(await stored.json()).toMatchObject({ value: 'busya' })
  // No other card wrote a choice: the first card shows its fallback without pinning it.
  const keys = await request.get(`/api/storage?prefix=${encodeURIComponent('w:i:')}`)
  const listed = ((await keys.json()) as { keys: string[] }).keys
  expect(listed.filter((candidate) => candidate.endsWith(':card/litter'))).toEqual([key])
})

// F7: `radix-ui` is a federation singleton, so a widget's menu is the top layer of the host's
// fullscreen dialog rather than a separate stack: Escape closes the menu alone.
test('fullscreen — Escape on the open switcher closes only the switcher', async ({
  page,
  request,
}) => {
  await seedCats(request, [OFELIA, BUSYA])
  const ofelia = new OfeliaPage(page)
  await ofelia.seedOfeliaWidget()

  await new BoardPage(page).expandCard(0)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Выбрать лоток · сейчас Лоток · Офелия' }).click()
  const menu = page.getByRole('menu', { name: 'Лотки' })
  await expect(menu).toBeVisible()

  await page.keyboard.press('Escape')

  await expect(menu).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Лоток · Офелия' })).toBeVisible()
})

// F10: the two-line title clamp is CSS, so it is checked in a real browser. A 268 px compact card
// (page 05, frame B: one shared litter, a stack and two controls) must wrap its title to two lines
// rather than cut it to one.
test.describe('compact header', () => {
  // A `w:4` card is 268 px wide here: 899 − 15 (scrollbar) − 40 (padding) = 844 px of board.
  test.use({ viewport: { width: 899, height: 900 } })

  test('a long litter title wraps to two lines beside the stack and the controls', async ({
    page,
    request,
  }) => {
    await seedCats(request, [OFELIA, { id: 'busya', name: 'Буся', litterId: 'ofelia' }])
    await page.goto('/')
    await new HeaderPage(page).addWidget('Лоток')
    const card = new BoardPage(page).getCard(0)
    const title = card.getByRole('heading', { name: 'Лоток · Офелия и Буся' })
    await expect(title).toBeVisible()

    const width = (await card.boundingBox())?.width ?? 0
    expect(width).toBeGreaterThan(250)
    expect(width).toBeLessThan(290)
    // The compact tier: its icon actions, and the two inline controls in the header row.
    await expect(card.getByRole('button', { name: 'Какашки убраны' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Развернуть' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Удалить' })).toBeVisible()
    await expect(card.getByRole('button', { name: SWITCHER })).toHaveCount(0)

    const box = await title.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        clamp: style.getPropertyValue('-webkit-line-clamp'),
        lineHeight: Number.parseFloat(style.lineHeight),
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }
    })
    expect(box.clamp).toBe('2')
    expect(Math.round(box.clientHeight / box.lineHeight)).toBe(2)
    expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight + 1)
  })
})

// Review Focus: a card that is still loading can be removed from the board. The ledger read is
// held forever; service workers are blocked, because `page.route` does not see requests a
// service worker makes, and this PWA's worker would otherwise answer around the stall.
test.describe('delete while failing', () => {
  test.use({ serviceWorkers: 'block' })

  test('a card whose ledger read is stalled is deleted from the board', async ({ page }) => {
    await page.route(
      (url) => decodeURIComponent(url.pathname).endsWith('/litter/ofelia/ledger'),
      () => {},
    )
    await page.goto('/')
    await new HeaderPage(page).addWidget('Лоток')
    const board = new BoardPage(page)
    await expect(board.widgetCards).toHaveCount(1)
    await expect(board.getCard(0).getByLabel('Загрузка виджета «Лоток»')).toBeVisible()

    await board.removeCard(0)

    await expect(board.widgetCards).toHaveCount(0)
  })
})
