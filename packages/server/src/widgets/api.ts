import type { WidgetServerContext } from '@shared/widgets/contracts'

import type { BrowserAutomationClient } from '../browser/client'
import { createWidgetBrowserApi } from '../browser/widget-api'
import { createWidgetServerStorageApi, type CreateWidgetServerStorageApiOptions } from './storage'

export type CreateWidgetServerApiOptions = CreateWidgetServerStorageApiOptions & {
  browserClient: BrowserAutomationClient
}

export function createWidgetServerApi(
  options: CreateWidgetServerApiOptions,
): WidgetServerContext['api'] {
  return {
    storage: createWidgetServerStorageApi(options),
    browser: createWidgetBrowserApi({
      widgetId: options.typeId,
      client: options.browserClient,
    }),
  }
}
