import { randomInt } from 'node:crypto'

import { CONSENT_CODE_DIGITS } from '@shared/hardware/spike-assumptions'

/**
 * A fresh consent code for a new scale user. It is stored only in the binding and its pending
 * command, sent only to the gateway, and shown only by the owner-only reveal endpoint.
 */
export function generateConsentCode(): string {
  return String(randomInt(0, 10 ** CONSENT_CODE_DIGITS)).padStart(CONSENT_CODE_DIGITS, '0')
}
