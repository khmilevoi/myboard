import type { Locator, Page } from '@playwright/test'

import { AccountMenuPage } from './AccountMenuPage.js'

/** The account name `/api/test/seed-session` gives every seeded account. */
const SEEDED_NAME = 'E2E'

/**
 * The board's «Оборудование» dialog (HardwareDialog.tsx): the list, the add-gateway view and the
 * add-hardware wizard, which replace each other inside one dialog.
 */
export class HardwarePage {
  readonly menu: AccountMenuPage
  readonly dialog: Locator
  /** The list view's primary button: «Добавить шлюз» / «Добавить оборудование». */
  readonly primary: Locator
  /** Gateway rows of the list (`hardware-gateway-{id}`). */
  readonly gatewayRows: Locator
  /** Scale rows of the list (`hardware-scale-{id}`). */
  readonly hardwareRows: Locator
  /** The inline confirm row of a destructive list action. */
  readonly confirm: Locator
  readonly confirmOk: Locator
  readonly confirmCancel: Locator
  /** The add-gateway view (`data-phase` = minting | waiting | connected | expired | failed). */
  readonly addGateway: Locator
  /** The one-time gateway code shown while waiting. */
  readonly gatewayCode: Locator
  /** The wizard step body; its `data-step` names the step. */
  readonly wizardStep: Locator

  constructor(readonly page: Page) {
    this.menu = new AccountMenuPage(page, SEEDED_NAME)
    this.dialog = page.getByTestId('hardware-dialog')
    this.primary = this.dialog.getByTestId('hardware-primary')
    this.gatewayRows = this.dialog.locator('[data-testid^="hardware-gateway-"]')
    this.hardwareRows = this.dialog.locator('[data-testid^="hardware-scale-"]')
    this.confirm = this.dialog.getByTestId('hardware-confirm')
    this.confirmOk = this.dialog.getByTestId('hardware-confirm-ok')
    this.confirmCancel = this.dialog.getByTestId('hardware-confirm-cancel')
    this.addGateway = this.dialog.getByTestId('hardware-add-gateway')
    this.gatewayCode = this.dialog.getByTestId('hardware-gateway-code')
    this.wizardStep = this.dialog.getByTestId('hardware-wizard')
  }

  /** Opens the account menu and selects «Оборудование»; waits for the dialog. */
  async open(): Promise<void> {
    await this.menu.trigger.click()
    await this.menu.hardwareItem.click()
    await this.dialog.waitFor()
  }

  /** The profile row `index`: of the scale `hardwareId`, or of any scale when omitted. */
  profileRow(index: number, hardwareId?: string): Locator {
    if (hardwareId !== undefined) {
      return this.dialog.getByTestId(`hardware-profile-${hardwareId}-${index}`)
    }
    return this.dialog.locator(`[data-testid^="hardware-profile-"][data-testid$="-${index}"]`)
  }

  /** The gateway row of `gatewayId`. */
  gatewayRow(gatewayId: string): Locator {
    return this.dialog.getByTestId(`hardware-gateway-${gatewayId}`)
  }

  /** The scale row of `hardwareId`. */
  hardwareRow(hardwareId: string): Locator {
    return this.dialog.getByTestId(`hardware-scale-${hardwareId}`)
  }

  /** The wizard's scan result row of `address`; holds «Выбрать». */
  scanResult(address: string): Locator {
    return this.dialog.getByTestId(`hardware-scan-${address}`)
  }

  /** A button of the dialog by its accessible name. */
  button(name: string): Locator {
    return this.dialog.getByRole('button', { name, exact: true })
  }
}
