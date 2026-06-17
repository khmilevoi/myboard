import type { Locator, Page } from '@playwright/test'

export class HeaderPage {
  readonly addWidgetButton: Locator
  readonly themeToggle: Locator
  readonly widgetMenu: Locator

  constructor(readonly page: Page) {
    this.addWidgetButton = page.getByRole('button', { name: 'Add widget' })
    this.themeToggle = page.getByRole('group', { name: 'Theme' })
    this.widgetMenu = page.getByRole('menu')
  }

  async addWidget(name: string): Promise<void> {
    await this.addWidgetButton.click()
    await this.widgetMenu.getByRole('menuitem', { name }).click()
  }

  async setTheme(mode: 'Light' | 'Dark' | 'System theme'): Promise<void> {
    await this.themeToggle.getByRole('button', { name: mode }).click()
  }
}
