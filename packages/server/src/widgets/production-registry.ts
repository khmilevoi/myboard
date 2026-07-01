import { createWidgetServerRegistry } from './registry'
import { widgetServerList } from './widget-server-list.generated'

const registry = createWidgetServerRegistry(widgetServerList)

if (registry instanceof Error) throw registry

export const productionWidgetServerRegistry = registry
