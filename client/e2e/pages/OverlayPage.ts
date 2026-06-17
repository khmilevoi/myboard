import type { Locator, Page } from '@playwright/test'

export class OverlayPage {
  readonly dialog: Locator
  readonly closeButton: Locator

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog')
    this.closeButton = this.dialog.getByRole('button', { name: 'Close' })
  }

  async waitForOpen(): Promise<void> {
    await this.dialog.waitFor({ state: 'visible' })
  }

  async close(): Promise<void> {
    await this.closeButton.click()
  }

  async pressEscape(): Promise<void> {
    await this.page.keyboard.press('Escape')
  }
}
