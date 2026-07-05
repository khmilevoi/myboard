import { BrowserAutomationUnavailableError } from '@shared/widgets/browser-errors'

import type {
  BrowserAutomationClient,
  BrowserAutomationClientResult,
  BrowserAutomationInvokeArgs,
} from '../client'

export function makeFakeBrowserAutomationClient() {
  const calls: BrowserAutomationInvokeArgs[] = []
  let result: BrowserAutomationClientResult = new BrowserAutomationUnavailableError({
    operation: 'fake',
  })

  const client: BrowserAutomationClient = {
    async invoke(args) {
      calls.push(args)
      return result
    },
  }

  return {
    client,
    calls,
    setResult(next: BrowserAutomationClientResult) {
      result = next
    },
  }
}
