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

  async resizeCard(width: number, height: number): Promise<void> {
    const card = new BoardPage(this.page).getCard(0)
    // ResizeObserver updates the grid after the viewport changes, then RGL
    // animates the card. A stable handle sampled before that update is stale.
    await card.evaluate(async (element) => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      )
    })
    await card.locator('.react-resizable-handle-se').hover()
    const grid = await this.page.getByTestId('board-grid-container').boundingBox()
    const before = await card.boundingBox()
    expect(grid).not.toBeNull()
    expect(before).not.toBeNull()
    const mobile = grid!.width < 768
    const scale = mobile ? 1 : Math.min(Math.max(grid!.width / 1920, 1), 2.5)
    const columns = mobile ? 1 : 12
    const gap = 10 * scale
    const row = mobile ? 40 : 30 * scale
    const column = (grid!.width - (columns + 1) * gap) / columns
    const targetWidth = column * width + gap * (width - 1)
    const targetHeight = row * height + gap * (height - 1)
    const handle = await card.locator('.react-resizable-handle-se').boundingBox()
    expect(handle).not.toBeNull()
    const start = { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 }
    await this.page.mouse.move(start.x, start.y)
    await this.page.mouse.down()
    await expect(this.page.locator('[data-interacting="true"]')).toBeVisible()
    await this.page.mouse.move(
      start.x + targetWidth - before!.width,
      start.y + targetHeight - before!.height,
      { steps: 10 },
    )
    await this.page.mouse.up()
    await expect
      .poll(async () => {
        const current = (await card.boundingBox())!
        return Math.abs(current.width - targetWidth) + Math.abs(current.height - targetHeight)
      })
      .toBeLessThan(2)
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
