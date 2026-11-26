import type { Locator, Page } from '@playwright/test'

/**
 * The board header's avatar trigger + dropdown menu (AccountMenu.tsx), and the profile and crop
 * dialogs it opens (ProfileDialog.tsx, AvatarCropDialog.tsx).
 */
export class AccountMenuPage {
  readonly trigger: Locator
  readonly myDevicesItem: Locator
  readonly profileItem: Locator
  /** The account photo inside the trigger; absent while the account has none. */
  readonly triggerImage: Locator
  /** The photo in the open menu's head; absent while the account has none. */
  readonly headAvatar: Locator
  /** The camera badge on the menu head's avatar: the picker, then the crop dialog. */
  readonly avatarBadge: Locator
  /** The hidden picker shared by the badge and the profile. */
  readonly avatarInput: Locator
  readonly cropDialog: Locator
  readonly cropStage: Locator
  readonly cropSave: Locator
  readonly cropError: Locator
  readonly profileDialog: Locator
  readonly profileAvatar: Locator
  readonly profileRemovePhoto: Locator

  constructor(
    readonly page: Page,
    accountName: string,
  ) {
    this.trigger = page.getByRole('button', { name: accountName })
    this.myDevicesItem = page.getByRole('menuitem', { name: 'Мои устройства' })
    this.profileItem = page.getByTestId('account-menu-profile')
    this.triggerImage = this.trigger.getByTestId('account-avatar-image')
    this.headAvatar = page.getByTestId('account-menu-head-avatar')
    this.avatarBadge = page.getByTestId('account-avatar-badge')
    this.avatarInput = page.getByTestId('account-avatar-input')
    this.cropDialog = page.getByTestId('avatar-crop-dialog')
    this.cropStage = page.getByTestId('avatar-crop-stage')
    this.cropSave = page.getByTestId('avatar-crop-save')
    this.cropError = page.getByTestId('avatar-crop-error')
    this.profileDialog = page.getByTestId('profile-dialog')
    this.profileAvatar = page.getByTestId('profile-avatar-image')
    this.profileRemovePhoto = page.getByTestId('profile-remove-photo')
  }

  /** Opens the dropdown and selects "Мои устройства", which mounts MyDevicesDialog. */
  async openMyDevices(): Promise<void> {
    await this.trigger.click()
    await this.myDevicesItem.click()
  }

  /** Opens the dropdown and selects "Профиль". */
  async openProfile(): Promise<void> {
    await this.trigger.click()
    await this.profileItem.click()
    await this.profileDialog.waitFor()
  }

  /**
   * Picks `file` through the menu's camera badge — the menu closes and the crop dialog opens.
   * Leaves the crop dialog open for the caller.
   */
  async pickAvatarFromBadge(file: { name: string; mimeType: string; buffer: Buffer }) {
    await this.trigger.click()
    const chooser = this.page.waitForEvent('filechooser')
    await this.avatarBadge.click()
    await (await chooser).setFiles(file)
    await this.cropDialog.waitFor()
  }

  /**
   * Badge → file → crop dialog → Сохранить, then waits for the dialog to close. An open Radix
   * dialog hides the rest of the page from the accessibility tree — the trigger included — so
   * trigger assertions only work once it is gone.
   */
  async uploadAvatar(file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
    await this.pickAvatarFromBadge(file)
    await this.cropSave.click()
    await this.cropDialog.waitFor({ state: 'detached' })
  }

  /** Closes the open dialog the way a user would. */
  async closeProfile(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await this.profileDialog.waitFor({ state: 'detached' })
  }

  /** The `/files/<blobId>` URL the trigger shows. */
  async triggerImageUrl(): Promise<string> {
    const src = await this.triggerImage.getAttribute('src')
    if (!src) throw new Error('the account trigger shows no avatar image')
    return src
  }
}
