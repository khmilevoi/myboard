import type { BrowserGatewayError } from '@shared/widgets/browser-errors'

export type BrowserAutomationInvokeArgs = {
  widgetId: string
  taskId: string
  payload: unknown
}

export type BrowserAutomationClientSuccess = { result: unknown }
export type BrowserAutomationClientResult = BrowserGatewayError | BrowserAutomationClientSuccess

export type BrowserAutomationClient = {
  invoke(args: BrowserAutomationInvokeArgs): Promise<BrowserAutomationClientResult>
}
