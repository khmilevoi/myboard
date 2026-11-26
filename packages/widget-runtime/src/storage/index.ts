import type { FileSlot } from './file-slot'
import type { StorageApi } from './types'

export { purgeLocalData } from './client/db'
export type { AccountGate } from './account-gate'

export type ScopedStorage = { client: StorageApi; server: StorageApi }

/** A scoped-route branch: its key/value storage plus its file slots (`@files/<key>`). */
export type BranchStorage = ScopedStorage & {
  /** The file slot `key` on this branch; one shared instance per branch and key per runtime. */
  files(key: string): FileSlot
}

export type WidgetStorage = {
  /** Scoped to this widget placement (w:i:<instanceId>:). */
  instance: ScopedStorage
  /** Shared across all placements of this widget type (w:t:<typeId>:). */
  shared: ScopedStorage
  /**
   * Scoped to this widget type AND the signed-in viewer (w:a:<typeId>:<accountId>:). Direct
   * operations return StorageError 'account_unavailable' while no account is known.
   */
  account: BranchStorage
}
