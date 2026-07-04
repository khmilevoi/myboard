import type { RuntimeWidgetBrowserDefinition } from '@shared/widgets/browser-contracts'

import type { BrowserTaskContext } from '../browser/context'
import { diagnosticsDefinition } from '../diagnostics'
import { makeWidgetBrowserRegistry } from './registry'

export function composeBrowserRegistry(
  widgetBrowserList: readonly RuntimeWidgetBrowserDefinition<BrowserTaskContext>[],
) {
  return makeWidgetBrowserRegistry<BrowserTaskContext>([diagnosticsDefinition, ...widgetBrowserList])
}
