import { expect, test, type Page } from '@playwright/test'

import { BoardPage } from './pages/BoardPage.js'
import { HeaderPage } from './pages/HeaderPage.js'

const MOBILE_VIEWPORT = { width: 390, height: 844 }

// hasTouch cannot be changed at runtime, so it is declared here; the viewport
// starts at desktop size because seeding goes through the header controls, and
// is switched to phone size inside each test.
test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } })

// Longer than react-grid-layout's 200ms item transition, so "unchanged for this
// long" means the relayout is genuinely over rather than merely not started.
const SETTLE_MS = 300

// The board flips `data-mobile` — and therefore reveals the grip — one render
// BEFORE React Grid Layout applies the new item geometry, and the items then
// animate for 200ms (react-grid-layout/css/styles.css: `.react-grid-item`).
// Sampled the moment the grip appears, the cards still measure 296.5x112.5, i.e.
// the desktop size. So poll until every card rect has held still for SETTLE_MS,
// carrying the previous sample on `window` between polls.
//
// The predicate must stay SYNCHRONOUS. waitForFunction tests the truthiness of
// whatever the predicate returns (playwright-core `coreBundle.js`: `const
// success = predicate(); if (success) { fulfill(success); return }`), and an
// async predicate returns an always-truthy Promise — it would resolve on the
// first call, making `polling` dead code and the wait a fixed sleep.
async function waitForSettledCards(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as { __cardSettle?: unknown }).__cardSettle
  })

  await page.waitForFunction(
    (settleMs: number) => {
      const holder = window as unknown as { __cardSettle?: { rects: string; since: number } }
      const rects = Array.from(document.querySelectorAll('[data-testid="widget-card"]'))
        .map((card) => JSON.stringify(card.getBoundingClientRect()))
        .join('|')

      if (rects === '') return false
      if (holder.__cardSettle?.rects !== rects) {
        holder.__cardSettle = { rects, since: performance.now() }
        return false
      }

      return performance.now() - holder.__cardSettle.since > settleMs
    },
    SETTLE_MS,
    { polling: 100 },
  )
}

async function seedTwoWidgets(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
  })
  await page.reload()

  const header = new HeaderPage(page)
  await header.addWidget('Часы')
  await header.addWidget('Часы')
  await expect(new BoardPage(page).widgetCards).toHaveCount(2)

  await page.setViewportSize(MOBILE_VIEWPORT)
  // The grip is only rendered visible once the board resolves to mobile metrics,
  // so this waits for the breakpoint — but not for the relayout it triggers.
  await expect(new BoardPage(page).getGrip(0)).toBeVisible()
  await waitForSettledCards(page)
}

async function recordTouchPrevention(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store: boolean[] = []
    ;(window as unknown as { __touchPrevented: boolean[] }).__touchPrevented = store
    // Bubble phase on document runs AFTER react-draggable's own listener on the
    // grid item, so defaultPrevented already reflects its decision.
    document.addEventListener('touchstart', (event) => store.push(event.defaultPrevented))
  })
}

const readTouchPrevention = (page: Page): Promise<boolean[]> =>
  page.evaluate(() => (window as unknown as { __touchPrevented: boolean[] }).__touchPrevented)

test('cards span the full width and stack vertically on a phone', async ({ page }) => {
  await seedTwoWidgets(page)

  const board = new BoardPage(page)
  const first = (await board.getCard(0).boundingBox())!
  const second = (await board.getCard(1).boundingBox())!

  expect(first.width).toBeGreaterThan(300)
  expect(Math.abs(first.width - second.width)).toBeLessThan(2)
  // A newly added widget is placed ABOVE the existing ones, so card index order
  // is not top-to-bottom order. Sort before asserting they stack without
  // overlapping, which is the property under test.
  const [upper, lower] = [first, second].sort((a, b) => a.y - b.y)
  expect(lower.y).toBeGreaterThanOrEqual(upper.y + upper.height)
})

test('a touch on the card body leaves the page scrollable', async ({ page }) => {
  await seedTwoWidgets(page)
  await recordTouchPrevention(page)

  const box = (await new BoardPage(page).getCard(0).boundingBox())!
  await page.touchscreen.tap(box.x + 20, box.y + box.height - 20)

  expect(await readTouchPrevention(page)).toEqual([false])
})

test('a touch on the drag grip cancels scrolling so the card can be dragged', async ({ page }) => {
  await seedTwoWidgets(page)
  await recordTouchPrevention(page)

  const grip = (await new BoardPage(page).getGrip(0).boundingBox())!
  await page.touchscreen.tap(grip.x + grip.width / 2, grip.y + grip.height / 2)

  expect(await readTouchPrevention(page)).toEqual([true])
})

// The card controls used to be revealed only by `.frame:hover`, which a touch
// device never fires — leaving an invisible but fully clickable "Удалить"
// button in the corner of every card. The stylesheet now hides them only where
// hover exists, so on a touch device they must be on screen, opaque, and
// actually usable without any hover.
test('card controls are visible and usable on a touch device without hovering', async ({
  page,
}) => {
  await seedTwoWidgets(page)

  const board = new BoardPage(page)
  const card = board.getCard(0)
  const remove = card.getByRole('button', { name: 'Удалить' })

  // Read opacity off the container the stylesheet sets it on. opacity is not
  // inherited, so asserting it on the button would always report the button's
  // own untouched `1` and could never fail.
  await expect(card.locator('[data-placement="overlay"]')).toHaveCSS('opacity', '1')
  await expect(remove).toBeVisible()
  // pointer-events IS inherited, so this one does reflect the container.
  await expect(remove).toHaveCSS('pointer-events', 'auto')

  // The functional half, which no CSS assertion can fake: Playwright's
  // actionability check fails on a `pointer-events: none` control, so a
  // completed click proves the control is genuinely reachable.
  await board.removeCard(0)
  await expect(board.widgetCards).toHaveCount(1)
})
