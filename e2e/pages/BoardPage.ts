import type { Locator, Page } from '@playwright/test'

export class BoardPage {
  readonly widgetCards: Locator
  readonly emptyState: Locator

  constructor(readonly page: Page) {
    this.widgetCards = page.locator('[data-testid="widget-card"]')
    this.emptyState = page.getByRole('heading', { name: 'No widgets yet' })
  }

  getCard(index: number): Locator {
    return this.widgetCards.nth(index)
  }

  async expandCard(index: number): Promise<void> {
    await this.getCard(index).getByRole('button', { name: 'Expand' }).click()
  }

  async removeCard(index: number): Promise<void> {
    await this.getCard(index).getByRole('button', { name: 'Remove' }).click()
  }
}
