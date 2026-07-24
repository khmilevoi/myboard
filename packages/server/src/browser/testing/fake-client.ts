import { BrowserAutomationUnavailableError, type BrowserGatewayError } from '@shared/widgets/browser-errors'

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

  const recoveryCalls: string[] = []
  let recovery: BrowserGatewayError | { retained: boolean } = { retained: false }

  const client: BrowserAutomationClient = {
    async invoke(args) {
      calls.push(args)
      return result
    },
    async recoveryState({ widgetId }) {
      recoveryCalls.push(widgetId)
      return recovery
    },
  }

  return {
    client,
    calls,
    setResult(next: BrowserAutomationClientResult) {
      result = next
    },
    recoveryCalls,
    setRecoveryState(next: BrowserGatewayError | { retained: boolean }) {
      recovery = next
    },
  }
}
