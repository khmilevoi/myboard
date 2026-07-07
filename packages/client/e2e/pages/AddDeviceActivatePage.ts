import type { Locator, Page } from '@playwright/test'

/** The activation app's `/add-device` screen (AddDeviceScreen.tsx). */
export class AddDeviceActivatePage {
  readonly codeInput: Locator
  readonly continueButton: Locator
  readonly createPasskeyButton: Locator
  readonly errorText: Locator
  readonly waitingHeading: Locator
  readonly rejectedHeading: Locator

  constructor(readonly page: Page) {
    this.codeInput = page.getByLabel('Код с другого устройства')
    this.continueButton = page.getByRole('button', { name: 'Продолжить' })
    this.createPasskeyButton = page.getByRole('button', { name: /Создать passkey/ })
    this.errorText = page.getByRole('alert')
    this.waitingHeading = page.getByRole('heading', { name: 'Ожидаем подтверждения' })
    this.rejectedHeading = page.getByRole('heading', { name: 'Запрос отклонён' })
  }

  async gotoAddDevice(token?: string): Promise<void> {
    await this.page.goto(token ? `/add-device?token=${token}` : '/add-device')
  }

  /**
   * Types a code into the (shared choose/manual) code field. Uses click +
   * pressSequentially rather than `.fill()` -- ActivatePage.fillName's
   * documented CDP WebAuthn virtual-authenticator hang applies to this field
   * too, since this screen also carries a CDP WebAuthn session.
   */
  async enterCode(code: string): Promise<void> {
    await this.codeInput.click()
    await this.codeInput.pressSequentially(code)
  }

  async submitCode(): Promise<void> {
    await this.continueButton.click()
  }

  async createPasskey(): Promise<void> {
    await this.createPasskeyButton.click()
  }

  /** Waits for the post-approval auto-login redirect back to the board root. */
  async waitForBoardRedirect(): Promise<void> {
    await this.page.waitForURL('/')
  }
}
