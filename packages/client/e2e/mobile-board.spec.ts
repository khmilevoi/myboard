import { expect, test, type Page } from '@playwright/test'

import { BoardPage } from './pages/BoardPage.js'
import { HeaderPage } from './pages/HeaderPage.js'

const MOBILE_VIEWPORT = { width: 390, height: 844 }

// hasTouch cannot be changed at runtime, so it is declared here; the viewport
// starts at desktop size because seeding goes through the header controls, and
// is switched to phone size inside each test.
test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } })

// React Grid Layout animates `transform`, `width` and `height` for 200ms
// (react-grid-layout/css/styles.css: `.react-grid-item`). The grip becomes
// visible on the very render that STARTS that animation, so visibility alone is
// not enough to measure against: a boundingBox() taken right after it samples a
// frame mid-flight, and a tap aimed at those stale coordinates misses the grip.
async function waitForSettledCards(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const cards = Array.from(document.querySelectorAll('[data-testid="widget-card"]'))
    if (cards.length === 0) return false
    if (cards.some((card) => card.getAnimations().length > 0)) return false

    const measure = () =>
      cards.map((card) => JSON.stringify(card.getBoundingClientRect())).join('|')
    const before = measure()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    return measure() === before
  })
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
  // so this doubles as a wait for the relayout.
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
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height)
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
