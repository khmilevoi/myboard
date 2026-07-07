import type { Locator, Page } from '@playwright/test'

/** The "Мои устройства" dialog (MyDevicesDialog.tsx). */
export class MyDevicesDialogPage {
  readonly dialog: Locator
  readonly addDeviceButton: Locator

  constructor(readonly page: Page) {
    this.dialog = page.getByTestId('my-devices-dialog')
    this.addDeviceButton = this.dialog.getByRole('button', { name: 'Добавить устройство' })
  }

  /** Opens the "Добавить устройство" modal (AddDeviceModal.tsx) on top of this dialog. */
  async openAddDevice(): Promise<void> {
    await this.addDeviceButton.click()
  }
}
