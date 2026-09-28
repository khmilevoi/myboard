import { expect, type Locator, type Page } from '@playwright/test'

import { BoardPage } from './BoardPage.js'
import { HeaderPage } from './HeaderPage.js'

export class CatCarePage {
  readonly dialog: Locator
  readonly eaten: Locator
  readonly pending: Locator

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Питание кошки' })
    this.eaten = this.dialog.getByTestId('cat-care-eaten-kcal')
    this.pending = this.dialog.getByTestId('cat-care-pending-kcal')
  }

  async add(): Promise<void> {
    await this.page.goto('/')
    await new HeaderPage(this.page).addWidget('Питание кошки')
    await this.open(0)
  }

  async open(index = 0): Promise<void> {
    await new BoardPage(this.page).expandCard(index)
    await expect(this.dialog).toBeVisible()
    await expect(this.dialog.getByRole('button', { name: 'Кормление', exact: true })).toBeVisible()
  }

  async close(): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await expect(this.dialog).toHaveCount(0)
  }

  async tab(name: 'Дневник' | 'История и статистика' | 'Продукты' | 'Профиль'): Promise<void> {
    await this.dialog.getByRole('button', { name, exact: true }).click()
  }

  async save(): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(this.dialog.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0)
  }

  async addProduct(name = 'Тестовый корм', kcal = '400'): Promise<void> {
    await this.tab('Продукты')
    await this.dialog.getByRole('button', { name: 'Добавить продукт', exact: true }).click()
    await this.dialog.getByLabel('Название продукта', { exact: true }).fill(name)
    await this.dialog.getByLabel('Калорийность', { exact: true }).fill(kcal)
    await this.dialog.getByLabel('Обычная порция, г', { exact: true }).fill('30')
    await this.save()
    await this.tab('Дневник')
  }

  async feed(
    options: { grams?: string; mode?: 'eaten' | 'offered'; time?: string } = {},
  ): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Кормление', exact: true }).click()
    if (options.grams)
      await this.dialog.getByLabel('Порция, г', { exact: true }).fill(options.grams)
    if (options.mode)
      await this.dialog.getByLabel('Что измерили', { exact: true }).selectOption(options.mode)
    if (options.time)
      await this.dialog.getByLabel('Когда кормили', { exact: true }).fill(options.time)
    await this.save()
  }
}
