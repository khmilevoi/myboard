import { action, atom, withAsync, withConnectHook, wrap } from '@reatom/core'
import type { z } from 'zod'
import { clearExpired } from '../client/db'
import type { StorageApi, StorageError, StorageOptions } from '../types'

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

export type ReatomStorageKeyOptions<T> = {
  api: StorageApi
  key: string
  schema?: z.ZodType<T>
}

/** Reactive value of a single key over StorageApi.subscribe. */
export function reatomStorageKey<T>(
  { api, key, schema }: ReatomStorageKeyOptions<T>,
  name: string,
) {
  const value = atom<T | null>(null, `${name}.value`)
  const error = atom<StorageError | null>(null, `${name}.error`)

  value.extend(
    withConnectHook(() =>
      // external subscription → wrap the listener itself (addEventListener style)
      api.subscribe<T>(
        key,
        wrap((event) => {
          if (event instanceof Error) return error.set(event)
          error.set(null)
          value.set(event.value)
        }),
        schema,
      ),
    ),
  )

  return { value, error }
}
