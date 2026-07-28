import type { Locator, Page } from '@playwright/test'

export class HeaderPage {
  readonly addWidgetButton: Locator
  readonly themeToggle: Locator
  readonly themeCycleButton: Locator

  constructor(readonly page: Page) {
    const header = page.getByRole('banner')
    this.addWidgetButton = header.getByRole('button', { name: 'Добавить виджет' })
    this.themeToggle = header.getByRole('radiogroup', { name: 'Тема' })
    // The accessible name embeds the current mode (e.g. "Тема: Тёмная тема.
    // Сменить"), so it changes on every click -- match the constant suffix.
    this.themeCycleButton = header.getByRole('button', { name: /Сменить$/ })
  }

  async addWidget(title: string): Promise<void> {
    await this.addWidgetButton.click()
    await this.page.getByRole('button', { name: `Добавить: ${title}` }).click()
  }

  async setTheme(mode: 'Светлая тема' | 'Тёмная тема' | 'Системная тема'): Promise<void> {
    await this.themeToggle.getByRole('radio', { name: mode }).click()
  }
}
