import type { Locator, Page } from '@playwright/test'

export class HeaderPage {
  readonly addWidgetButton: Locator
  readonly themeToggle: Locator

  constructor(readonly page: Page) {
    const header = page.getByRole('banner')
    this.addWidgetButton = header.getByRole('button', { name: 'Добавить виджет' })
    this.themeToggle = header.getByRole('radiogroup', { name: 'Тема' })
  }

  async addWidget(title: string): Promise<void> {
    await this.addWidgetButton.click()
    await this.page.getByRole('button', { name: `Добавить: ${title}` }).click()
  }

  async setTheme(mode: 'Светлая тема' | 'Тёмная тема' | 'Системная тема'): Promise<void> {
    await this.themeToggle.getByRole('radio', { name: mode }).click()
  }
}
