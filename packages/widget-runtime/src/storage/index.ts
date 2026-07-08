import type { StorageApi } from './types'

export type ScopedStorage = { client: StorageApi; server: StorageApi }

export type WidgetStorage = {
  /** Scoped to this widget placement (w:i:<instanceId>:). */
  instance: ScopedStorage
  /** Shared across all placements of this widget type (w:t:<typeId>:). */
  shared: ScopedStorage
}
