import type { BrowserGatewayError } from '@shared/widgets/browser-errors'

export type BrowserAutomationInvokeArgs = {
  widgetId: string
  taskId: string
  payload: unknown
}

export type BrowserAutomationClientSuccess = { result: unknown }
export type BrowserAutomationClientResult = BrowserGatewayError | BrowserAutomationClientSuccess

export type BrowserAutomationRecoveryState = { retained: boolean }

export type BrowserAutomationClient = {
  invoke(args: BrowserAutomationInvokeArgs): Promise<BrowserAutomationClientResult>
  recoveryState(args: {
    widgetId: string
  }): Promise<BrowserGatewayError | BrowserAutomationRecoveryState>
}
