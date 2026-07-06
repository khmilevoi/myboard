import type { Locator, Page } from '@playwright/test'

export class ActivatePage {
  readonly nameInput: Locator
  readonly createPasskeyButton: Locator
  readonly signInButton: Locator
  readonly errorText: Locator

  constructor(readonly page: Page) {
    this.nameInput = page.getByLabel('Ваше имя')
    this.createPasskeyButton = page.getByRole('button', { name: /Создать ключ доступа/ })
    this.signInButton = page.getByRole('button', { name: /Войти с ключом доступа/ })
    this.errorText = page.locator('.text-destructive')
  }

  async gotoActivate(token: string): Promise<void> {
    await this.page.goto(`/activate?token=${token}`)
  }

  async fillName(name: string): Promise<void> {
    // locator.fill() hangs indefinitely on this page when a CDP WebAuthn
    // virtual authenticator session is attached to the same page (observed
    // with @playwright/test 1.61 + WebAuthn.enable); click + real keystrokes
    // sidesteps whatever internal fill() mechanism conflicts with the extra
    // CDP session and is exercised elsewhere in this suite anyway.
    await this.nameInput.click()
    await this.nameInput.pressSequentially(name)
  }

  async submitRegister(): Promise<void> {
    await this.createPasskeyButton.click()
  }

  async submitLogin(): Promise<void> {
    await this.signInButton.click()
  }

  /** Waits for the successful-registration/login redirect back to the board root. */
  async waitForBoardRedirect(): Promise<void> {
    await this.page.waitForURL('/')
  }
}
