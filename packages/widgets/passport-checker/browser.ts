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

export function makePassportCheckerBrowser(options: {
  checkerUrl: string
  recoverySshTarget: string | null
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
})
