import type { WidgetServerBrowserApi } from '@shared/widgets/browser-contracts'
import { BrowserAutomationProtocolError } from '@shared/widgets/browser-errors'

import type { BrowserAutomationClient } from './client'

export function createWidgetBrowserApi({
  widgetId,
  client,
}: {
  widgetId: string
  client: BrowserAutomationClient
}): WidgetServerBrowserApi {
  return {
    async invoke(task, payload) {
      const result = await client.invoke({ widgetId, taskId: task.id, payload })
      if (result instanceof Error) return result

      const validated = task.result.safeParse(result.result)
      if (!validated.success) {
        return new BrowserAutomationProtocolError({
          phase: 'result',
          widgetId,
          taskId: task.id,
        })
      }
      return validated.data
    },
  }
}
