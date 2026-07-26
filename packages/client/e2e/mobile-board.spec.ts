import { expect, test, type Page } from '@playwright/test'

import { BoardPage } from './pages/BoardPage.js'
import { HeaderPage } from './pages/HeaderPage.js'

const MOBILE_VIEWPORT = { width: 390, height: 844 }

// hasTouch cannot be changed at runtime, so it is declared here; the viewport
// starts at desktop size because seeding goes through the header controls, and
// is switched to phone size inside each test.
test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } })

// The board flips `data-mobile` — and therefore reveals the grip — one render
// BEFORE React Grid Layout applies the new item geometry, and the items then
// animate for 200ms (react-grid-layout/css/styles.css: `.react-grid-item`).
// Visibility alone is measured 296.5x112.5, i.e. still the desktop size. So wait
// for two geometry samples taken further apart than that transition to agree: a
// relayout that has not started yet still shows up as a difference.
async function waitForSettledCards(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      const measure = () =>
        Array.from(document.querySelectorAll('[data-testid="widget-card"]'))
          .map((card) => JSON.stringify(card.getBoundingClientRect()))
          .join('|')

      const before = measure()
      if (before === '') return false
      await new Promise((resolve) => setTimeout(resolve, 250))
      return measure() === before
    },
    null,
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
