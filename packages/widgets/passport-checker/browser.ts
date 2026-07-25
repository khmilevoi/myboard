import { defineWidgetBrowser } from '@shared/widgets/browser-contracts'
import type { BrowserTaskContext } from 'browser-automation/task-context'

import { makePassportCheckHandler } from './browser/check'
import { passportCheckerBrowserSchemas } from './types'

export const PASSPORT_CHECKER_URL = 'https://pasport.org.ua/solutions/checker'

export function normalizeRecoverySshTarget(value: string | undefined) {
  const target = value?.trim()
  if (!target) return null
  return /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+$/.test(target) ? target : null
}

/**
 * PASSPORT_FORCE_RECOVERY is a testing lever, never set in production: `'1'` and
 * nothing else arms one forced trip through the Cloudflare recovery path per
 * service start (see PassportCheckHandlerOptions.forceRecovery). Absent, empty,
 * `'0'`, `'true'`, `' 1 '` and anything else are off — no trimming and no
 * truthiness coercion, so a stray value in a Compose env file cannot enable it
 * by accident.
 */
export function isForcedRecoveryEnabled(value: string | undefined) {
  return value === '1'
}

export function makePassportCheckerBrowser(options: {
  checkerUrl: string
  recoverySshTarget: string | null
  forceRecovery?: boolean
}) {
  return defineWidgetBrowser<BrowserTaskContext>()({
    schemas: passportCheckerBrowserSchemas,
    handlers: {
      check: makePassportCheckHandler(options),
    },
  })
}

export default makePassportCheckerBrowser({
  checkerUrl: PASSPORT_CHECKER_URL,
  recoverySshTarget: normalizeRecoverySshTarget(process.env.AUTOMATION_SSH_TARGET),
  forceRecovery: isForcedRecoveryEnabled(process.env.PASSPORT_FORCE_RECOVERY),
})
