import type { Locator, Page } from '@playwright/test'

/** The board header's avatar trigger + dropdown menu (AccountMenu.tsx). */
export class AccountMenuPage {
  readonly trigger: Locator
  readonly myDevicesItem: Locator
  /** The account photo inside the trigger; absent while the account has none. */
  readonly triggerImage: Locator
  /** The photo in the open menu's head; absent while the account has none. */
  readonly headAvatar: Locator
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
    this.headAvatar = page.getByTestId('account-menu-head-avatar')
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

  /**
   * Picks `file` through "Загрузить фото", waits for the photo to land in the menu head, then
   * closes the menu. The menu stays open while it uploads, and an open Radix menu hides the rest
   * of the page from the accessibility tree — the trigger included — so trigger assertions only
   * work once it is closed again.
   */
  async uploadAvatar(file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
    await this.trigger.click()
    const chooser = this.page.waitForEvent('filechooser')
    await this.uploadAvatarItem.click()
    await (await chooser).setFiles(file)
    await this.headAvatar.waitFor()
    await this.closeMenu()
  }

  /** Closes the open dropdown the way a user would. */
  async closeMenu(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await this.uploadAvatarItem.waitFor({ state: 'detached' })
  }

  /** The `/files/<blobId>` URL the trigger shows. */
  async triggerImageUrl(): Promise<string> {
    const src = await this.triggerImage.getAttribute('src')
    if (!src) throw new Error('the account trigger shows no avatar image')
    return src
  }
}
