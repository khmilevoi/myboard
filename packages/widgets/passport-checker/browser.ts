import { defineWidgetBrowser } from '@shared/widgets/browser-contracts'
import type { BrowserTaskContext } from 'browser-automation/task-context'

import { makePassportCheckHandler } from './browser/check'
import { passportCheckerBrowserSchemas } from './types'

export const PASSPORT_CHECKER_URL = 'https://pasport.org.ua/solutions/checker'

export function makePassportCheckerBrowser(options: { checkerUrl: string }) {
  return defineWidgetBrowser<BrowserTaskContext>()({
    schemas: passportCheckerBrowserSchemas,
    handlers: {
      check: makePassportCheckHandler(options),
    },
  })
}

export default makePassportCheckerBrowser({
  checkerUrl: PASSPORT_CHECKER_URL,
})
