import { expect, type Locator, type Page } from '@playwright/test'

import { BoardPage } from './BoardPage.js'
import { HeaderPage } from './HeaderPage.js'
import type { DutyPerson } from './OfeliaPage.js'

const TITLE = 'Статистика лотка'

export class OfeliaStatsPage {
  readonly card: Locator

  constructor(readonly page: Page) {
    // Located by the widget, not by its position on the board: the stats card
    // shares the board with the duty card, and their order is not its concern.
    // A mounted widget renders no title of its own, so the card is matched by
    // the content only this widget renders.
    this.card = new BoardPage(page).widgetCards.filter({
      has: page.getByTestId(/^ofelia-stats-cleanings-/),
    })
  }

  cleanings(person: DutyPerson): Locator {
    return this.card.getByTestId(`ofelia-stats-cleanings-${person}`)
  }

  debt(person: DutyPerson): Locator {
    return this.card.getByTestId(`ofelia-stats-debt-${person}`)
  }

  /** Adds the widget to the board already open in `page`; does not navigate. */
  async addStatsWidget(): Promise<void> {
    await new HeaderPage(this.page).addWidget(TITLE)
    // Wait past the "Загрузка…" gate: the rows render once the module model loads.
    await expect(this.card).toHaveCount(1)
  }
}
