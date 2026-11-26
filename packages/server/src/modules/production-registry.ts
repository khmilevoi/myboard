import { moduleServerList } from './module-server-list.generated'
import { makeModuleServerRegistry } from './registry'

const registry = makeModuleServerRegistry(moduleServerList)

if (registry instanceof Error) throw registry

export const productionModuleServerRegistry = registry
