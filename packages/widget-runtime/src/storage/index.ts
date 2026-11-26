import type { StorageApi } from './types'

export { purgeLocalData } from './client/db'
export type { AccountGate } from './account-gate'

export type ScopedStorage = { client: StorageApi; server: StorageApi }

export type WidgetStorage = {
  /** Scoped to this widget placement (w:i:<instanceId>:). */
  instance: ScopedStorage
  /** Shared across all placements of this widget type (w:t:<typeId>:). */
  shared: ScopedStorage
  /**
   * Scoped to this widget type AND the signed-in viewer (w:a:<typeId>:<accountId>:). Direct
   * operations return StorageError 'account_unavailable' while no account is known.
   */
  account: ScopedStorage
}
