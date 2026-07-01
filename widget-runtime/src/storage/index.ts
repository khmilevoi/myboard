import { makeDexieStorage } from './client/dexie-storage'
import { instanceNamespace, typeNamespace } from './scope'
import { makeHttpStorage } from './server/http-storage'
import type { StorageApi } from './types'

export type ScopedStorage = { client: StorageApi; server: StorageApi }

export type WidgetStorage = {
  /** Scoped to this widget placement (w:i:<instanceId>:). */
  instance: ScopedStorage
  /** Shared across all placements of this widget type (w:t:<typeId>:). */
  shared: ScopedStorage
}

export type MakeWidgetStorageOptions = {
  instanceId: string
  typeId: string
  /** Override the server base URL (defaults to '/api/storage'). */
  serverBaseUrl?: string
}

export function makeWidgetStorage(options: MakeWidgetStorageOptions): WidgetStorage {
  const instanceNs = instanceNamespace(options.instanceId)
  const typeNs = typeNamespace(options.typeId)
  return {
    instance: makeScopedStorage(instanceNs, options.serverBaseUrl),
    shared: makeScopedStorage(typeNs, options.serverBaseUrl),
  }
}

export function makeScopedStorage(scope: string, serverBaseUrl?: string): ScopedStorage {
  const scopeWithColon = `${scope}:`
  return {
    client: makeDexieStorage(scopeWithColon),
    server: makeHttpStorage(scopeWithColon, serverBaseUrl),
  }
}
