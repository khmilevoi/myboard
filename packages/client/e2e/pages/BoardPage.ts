import type { Locator, Page } from '@playwright/test'

export class BoardPage {
  readonly widgetCards: Locator
  readonly emptyState: Locator

  constructor(readonly page: Page) {
    this.widgetCards = page.locator('[data-testid="widget-card"]')
    this.emptyState = page.getByRole('heading', { name: 'Начните с первого виджета' })
  }

  getCard(index: number): Locator {
    return this.widgetCards.nth(index)
  }

  getGrip(index: number): Locator {
    return this.getCard(index).locator('.widget-drag-grip')
  }

  // The controls are hover-revealed on a desktop pointer and carry
  // `pointer-events: none` until then, so the card has to be hovered before the
  // click — Playwright checks the hit target before it moves the mouse.
  async expandCard(index: number): Promise<void> {
    await this.getCard(index).hover()
    await this.getCard(index).getByRole('button', { name: 'Развернуть' }).click()
  }

  async removeCard(index: number): Promise<void> {
    await this.getCard(index).hover()
    await this.getCard(index).getByRole('button', { name: 'Удалить' }).click()
  }
}
