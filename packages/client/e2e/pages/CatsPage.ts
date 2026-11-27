import { expect, type Locator, type Page } from '@playwright/test'

import { BoardPage } from './BoardPage.js'
import { HeaderPage } from './HeaderPage.js'

export type CatsTier = 'tiny' | 'compact' | 'standard' | 'large' | 'fullscreen'

export class CatsPage {
  readonly card: Locator
  /** The widget's root inside the card: it carries the rendered tier as `data-tier`. */
  readonly root: Locator
  readonly weighButton: Locator
  readonly switcher: Locator
  /** The host's fullscreen dialog around the card's fullscreen mount. */
  readonly overlay: Locator

  constructor(readonly page: Page) {
    this.card = new BoardPage(page).getCard(0)
    this.root = this.card.locator('[data-tier]').first()
    this.weighButton = this.card.getByRole('button', { name: 'Взвесить', exact: true })
    this.switcher = this.card.getByRole('button', { name: /^Выбрать кошку/ })
    this.overlay = page.getByRole('dialog', { name: 'Кошки' })
  }

  /** Expands the card into the fullscreen view and waits for its header. */
  async openFullscreen(): Promise<void> {
    await new BoardPage(this.page).expandCard(0)
    await expect(this.overlay).toBeVisible()
    await expect(this.overlay.getByRole('group', { name: 'Разделы' })).toBeVisible()
  }

  /** A tab of the fullscreen view: "Профиль", "Вес" or "Все кошки". */
  tab(name: string): Locator {
    return this.overlay.getByRole('group', { name: 'Разделы' }).getByRole('button', { name })
  }

  heading(name: string): Locator {
    return this.card.getByRole('heading', { name })
  }

  async expectTier(tier: CatsTier): Promise<void> {
    await expect(this.root).toHaveAttribute('data-tier', tier)
  }

  /** Opens the board, adds a "Кошки" card and waits past its loading state. */
  async addWidget(): Promise<void> {
    await this.page.goto('/')
    await new HeaderPage(this.page).addWidget('Кошки')
    await expect(this.card.getByRole('status', { name: 'Загрузка виджета «Кошки»' })).toHaveCount(0)
  }

  /** Weighs the card's cat through the "Вес" form with `kg` typed as given ("4,30"). */
  async weigh(kg: string): Promise<void> {
    await this.weighButton.click()
    const dialog = this.page.getByRole('dialog', { name: /^Вес · / })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Сколько весит').fill(kg)
    await dialog.getByRole('button', { name: 'Сохранить вес' }).click()
    await expect(dialog).toHaveCount(0)
  }
}
