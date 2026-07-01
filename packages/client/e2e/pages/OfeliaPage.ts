import { expect, type Locator, type Page } from '@playwright/test'

import { BoardPage } from './BoardPage.js'
import { HeaderPage } from './HeaderPage.js'

export type DutyPerson = 'Леша' | 'Карина'

export class OfeliaPage {
  readonly card: Locator
  readonly dutyName: Locator
  readonly confirmedPlaque: Locator
  readonly confirmButton: Locator
  readonly debtButton: Locator
  readonly forgiveButton: Locator
  readonly undoButton: Locator

  constructor(readonly page: Page) {
    this.card = new BoardPage(page).getCard(0)
    this.dutyName = this.card.getByTestId('ofelia-duty-person')
    this.confirmedPlaque = this.card.getByText('Уборка подтверждена')
    this.confirmButton = this.card.getByRole('button', { name: 'Какашки убраны' })
    this.debtButton = this.card.getByRole('button', { name: 'В долг' })
    this.forgiveButton = this.card.getByRole('button', { name: 'Простить' })
    this.undoButton = this.card.getByRole('button', { name: 'Откатить' })
  }

  debtChip(person: DutyPerson): Locator {
    return this.card.getByTestId(`debt-chip-${person}`)
  }

  async seedOfeliaWidget(): Promise<void> {
    await this.page.goto('/')
    await new HeaderPage(this.page).addWidget('Лоток Офелии')
    // Wait past the "Загрузка…" gate: the duty name only renders once
    // /api/time has synced and the StandardTier mounts.
    await expect(this.dutyName).toBeVisible()
  }
}
