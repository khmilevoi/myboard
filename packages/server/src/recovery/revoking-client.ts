import type { BrowserAutomationClient } from '../browser/client'
import type { RecoveryCapabilityStore } from './capability'

/**
 * A task acquire closes the widget's retained page inside browser-automation.
 * Revoking here -- before the task travels -- guarantees the operator's socket
 * dies first instead of going blank on a page that vanished underneath it.
 */
export function makeRecoveryRevokingClient(deps: {
  client: BrowserAutomationClient
  store: RecoveryCapabilityStore
}): BrowserAutomationClient {
  return {
    async invoke(args) {
      deps.store.revoke(args.widgetId)
      return deps.client.invoke(args)
    },
    recoveryState(args) {
      return deps.client.recoveryState(args)
    },
  }
}
