import { createDexieStorage } from './client/dexie-storage'
import { createHttpStorage } from './server/http-storage'
import { instanceNamespace, typeNamespace } from './scope'
import type { StorageApi } from './types'

export type ScopedStorage = { client: StorageApi; server: StorageApi }

export type WidgetStorage = {
  /** Scoped to this widget placement (w:i:<instanceId>:). */
  instance: ScopedStorage
  /** Shared across all placements of this widget type (w:t:<typeId>:). */
  shared: ScopedStorage
}

export type CreateWidgetStorageOptions = {
  instanceId: string
  typeId: string
  /** Override the server base URL (defaults to '/api/storage'). */
  serverBaseUrl?: string
}

export function createWidgetStorage(options: CreateWidgetStorageOptions): WidgetStorage {
  const instanceNs = instanceNamespace(options.instanceId)
  const typeNs = typeNamespace(options.typeId)
  return {
    instance: {
      client: createDexieStorage(instanceNs),
      server: createHttpStorage(instanceNs, options.serverBaseUrl),
    },
    shared: {
      client: createDexieStorage(typeNs),
      server: createHttpStorage(typeNs, options.serverBaseUrl),
    },
  }
}
