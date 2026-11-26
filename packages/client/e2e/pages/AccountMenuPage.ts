import type { Locator, Page } from '@playwright/test'

/** The board header's avatar trigger + dropdown menu (AccountMenu.tsx). */
export class AccountMenuPage {
  readonly trigger: Locator
  readonly myDevicesItem: Locator
  /** The account photo inside the trigger; absent while the account has none. */
  readonly triggerImage: Locator
  readonly uploadAvatarItem: Locator
  readonly removeAvatarItem: Locator
  readonly avatarError: Locator
  /** The hidden picker "Загрузить фото" opens. */
  readonly avatarInput: Locator

  constructor(
    readonly page: Page,
    accountName: string,
  ) {
    this.trigger = page.getByRole('button', { name: accountName })
    this.myDevicesItem = page.getByText('Мои устройства')
    this.triggerImage = this.trigger.getByTestId('account-avatar-image')
    this.uploadAvatarItem = page.getByTestId('account-avatar-upload')
    this.removeAvatarItem = page.getByTestId('account-avatar-remove')
    this.avatarError = page.getByTestId('account-avatar-error')
    this.avatarInput = page.getByTestId('account-avatar-input')
  }

  /** Opens the dropdown and selects "Мои устройства", which mounts MyDevicesDialog. */
  async openMyDevices(): Promise<void> {
    await this.trigger.click()
    await this.myDevicesItem.click()
  }

  /** Picks `file` through "Загрузить фото" (the menu stays open while it uploads). */
  async uploadAvatar(file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
    await this.trigger.click()
    const chooser = this.page.waitForEvent('filechooser')
    await this.uploadAvatarItem.click()
    await (await chooser).setFiles(file)
  }

  /** The `/files/<blobId>` URL the trigger shows. */
  async triggerImageUrl(): Promise<string> {
    const src = await this.triggerImage.getAttribute('src')
    if (!src) throw new Error('the account trigger shows no avatar image')
    return src
  }
}
