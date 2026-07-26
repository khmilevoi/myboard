import { typeNamespace } from '@shared/storage/scope'
import type { WidgetCronContext, WidgetServerContext } from '@shared/widgets/contracts'

import type { BrowserAutomationClient } from '../browser/client'
import { createWidgetBrowserApi } from '../browser/widget-api'
import type { ValkeyOps } from '../storage/valkey'
import {
  createWidgetServerStorageApi,
  makeWidgetScopedStorage,
  type CreateWidgetServerStorageApiOptions,
} from './storage'

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

export type MakeWidgetCronApiOptions = {
  ops: ValkeyOps
  typeId: string
  now: () => number
  browserClient: BrowserAutomationClient
}

export function makeWidgetCronApi({
  ops,
  typeId,
  now,
  browserClient,
}: MakeWidgetCronApiOptions): WidgetCronContext['api'] {
  return {
    storage: {
      shared: makeWidgetScopedStorage({ ops, namespace: typeNamespace(typeId), now }),
    },
    browser: createWidgetBrowserApi({ widgetId: typeId, client: browserClient }),
  }
}
