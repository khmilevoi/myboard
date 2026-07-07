import type { Locator, Page } from '@playwright/test'

/** The board header's avatar trigger + dropdown menu (AccountMenu.tsx). */
export class AccountMenuPage {
  readonly trigger: Locator
  readonly myDevicesItem: Locator

  constructor(
    readonly page: Page,
    accountName: string,
  ) {
    this.trigger = page.getByRole('button', { name: accountName })
    this.myDevicesItem = page.getByText('Мои устройства')
  }

  /** Opens the dropdown and selects "Мои устройства", which mounts MyDevicesDialog. */
  async openMyDevices(): Promise<void> {
    await this.trigger.click()
    await this.myDevicesItem.click()
  }
}
