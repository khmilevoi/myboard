import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// Crockford base32 (no I L O U), matches server's `formatAddCode` output
// (`XXXX-XXXX`) -- see packages/server/src/auth/add-tokens.ts.
export const ADD_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/

/**
 * The board-side "Добавить устройство" modal (AddDeviceModal.tsx). Reused
 * across the whole owner-side flow: confirm identity -> mint code -> (once
 * the joining device registers) flips in place to the approval card -> success.
 */
export class AddDeviceModalPage {
  readonly dialog: Locator
  // Same "Подтвердить" label is reused by two different phases (confirm
  // identity vs. approve a pending device) -- they never render at once, so
  // one locator name for the currently-visible button in either phase.
  readonly confirmButton: Locator
  readonly approveButton: Locator
  readonly denyButton: Locator
  readonly codeText: Locator
  readonly pendingHeading: Locator
  readonly successHeading: Locator

  constructor(readonly page: Page) {
    this.dialog = page.getByTestId('add-device-modal')
    this.confirmButton = this.dialog.getByRole('button', { name: 'Подтвердить' })
    this.approveButton = this.dialog.getByRole('button', { name: 'Подтвердить' })
    this.denyButton = this.dialog.getByRole('button', { name: 'Отклонить' })
    this.codeText = this.dialog.getByText(ADD_CODE_PATTERN)
    this.pendingHeading = this.dialog.getByRole('heading', {
      name: 'Устройство хочет присоединиться',
    })
    this.successHeading = this.dialog.getByRole('heading', { name: 'Устройство добавлено' })
  }

  /** Confirms identity via the fresh-UV WebAuthn ceremony, minting a code. */
  async confirmIdentity(): Promise<void> {
    await this.confirmButton.click()
  }

  /** Reads the formatted `XXXX-XXXX` add-device code shown once minted. */
  async readCode(): Promise<string> {
    const text = await this.codeText.textContent()
    if (!text) throw new Error('add-device code text not found in the modal')
    return text.trim()
  }

  /** Waits for the joining device's pending request to arrive over SSE. */
  async waitForPendingDevice(): Promise<void> {
    await expect(this.pendingHeading).toBeVisible({ timeout: 20_000 })
  }

  async approve(): Promise<void> {
    await this.approveButton.click()
  }

  async deny(): Promise<void> {
    await this.denyButton.click()
  }
}
