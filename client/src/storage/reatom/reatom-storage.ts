import { action, withAsync, wrap } from '@reatom/core'
import { clearExpired } from '../client/db'
import type { StorageApi, StorageOptions } from '../types'

/**
 * Status-tracked mutations over a StorageApi. The underlying api returns errors
 * as values; we re-throw them so withAsync captures them in `.error()`/`.status()`.
 */
export function reatomStorageMutations(api: StorageApi, name: string) {
  const set = action(async (key: string, value: unknown, options?: StorageOptions) => {
    const result = await wrap(api.set(key, value, options))
    if (result instanceof Error) throw result
  }, `${name}.set`).extend(withAsync({ status: true }))

  const remove = action(async (key: string) => {
    const result = await wrap(api.delete(key))
    if (result instanceof Error) throw result
  }, `${name}.remove`).extend(withAsync({ status: true }))

  return { set, remove }
}

/** Action that purges expired client (Dexie) rows. */
export function reatomClearExpired(name: string) {
  return action(async () => {
    await wrap(clearExpired())
  }, `${name}.clearExpired`).extend(withAsync())
}
