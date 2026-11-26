import { type APIRequestContext, expect, type Locator, type Page } from '@playwright/test'

import { BoardPage } from './BoardPage.js'
import { HeaderPage } from './HeaderPage.js'
import { OverlayPage } from './OverlayPage.js'

const TITLE = 'Вес'

export type WeightReading = { id: string; takenAt: number; kg: number }

/**
 * Seeds one weight reading for the account whose session cookie `request` carries, through the
 * same ingest path the hardware gateway uses (`/api/test/health/measurements`, test-only).
 */
export async function postWeightReading(
  request: APIRequestContext,
  reading: WeightReading,
): Promise<void> {
  const response = await request.post('/api/test/health/measurements', {
    data: {
      measurement: {
        id: reading.id,
        takenAt: reading.takenAt,
        metrics: { weight: { value: reading.kg, unit: 'kg' } },
        source: { kind: 'hardware', hardwareId: 'e2e-hardware', model: 'e2e' },
      },
    },
  })
  if (!response.ok()) {
    throw new Error(`health seed failed with status ${response.status()}: ${await response.text()}`)
  }
}

/** The card's readouts inside one container: the board card or the fullscreen dialog. */
export class WeightView {
  readonly value: Locator
  readonly delta: Locator
  readonly emptyTitle: Locator
  readonly singleHint: Locator
  /** The fullscreen `Измерения` list; the board card's small tiers render none. */
  readonly rows: Locator

  constructor(readonly root: Locator) {
    this.value = root.getByTestId('weight-value')
    this.delta = root.getByTestId('weight-delta')
    this.emptyTitle = root.getByText('Пока нет измерений')
    this.singleHint = root.getByText('Тренд появится со второго')
    this.rows = root.getByTestId('weight-row')
  }
}

export class WeightPage {
  readonly board: BoardPage
  readonly overlay: OverlayPage
  /** The board card. At its default size it is the standard tier: value, delta and trend, no list. */
  readonly card: WeightView
  readonly fullscreen: WeightView

  constructor(readonly page: Page) {
    this.board = new BoardPage(page)
    this.overlay = new OverlayPage(page)
    // The weight card is the only widget these specs place, and its empty state renders no
    // test id or label of its own to filter by, so the card is the board's first.
    this.card = new WeightView(this.board.getCard(0))
    this.fullscreen = new WeightView(this.overlay.dialog)
  }

  /** Adds the widget to the board already open in `page`; does not navigate. */
  async addWeightWidget(): Promise<void> {
    await new HeaderPage(this.page).addWidget(TITLE)
    await expect(this.board.widgetCards).toHaveCount(1)
  }

  async openFullscreen(): Promise<void> {
    await this.board.expandCard(0)
    await this.overlay.waitForOpen()
  }
}
