import type { Locator, Page } from '@playwright/test'

export class ActivatePage {
  readonly nameInput: Locator
  readonly createPasskeyButton: Locator
  readonly signInButton: Locator
  readonly scanButton: Locator
  readonly homeHeading: Locator
  readonly usedHeading: Locator
  readonly errorText: Locator

  constructor(readonly page: Page) {
    this.nameInput = page.getByLabel('Ваше имя')
    this.createPasskeyButton = page.getByRole('button', { name: /Создать passkey/ })
    this.signInButton = page.getByRole('button', { name: /Войти с passkey/ })
    this.scanButton = page.getByRole('button', { name: /Сканировать QR-код/ })
    this.homeHeading = page.getByRole('heading', { name: 'Вход в myboard' })
    this.usedHeading = page.getByRole('heading', { name: 'Приглашение уже использовано' })
    this.errorText = page.locator('.text-destructive')
  }

  async gotoActivate(token: string): Promise<void> {
    await this.page.goto(`/activate?token=${token}`)
  }

  /** The login landing (no invite token). */
  async gotoHome(): Promise<void> {
    await this.page.goto('/activate')
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
