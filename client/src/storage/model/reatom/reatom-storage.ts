import {
  action,
  atom,
  AtomState,
  Ext,
  withAsync,
  withChangeHook,
  withConnectHook,
  wrap,
} from '@reatom/core'
import { Atom } from '@reatom/core'
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

export type WithStorageKeyOptions<T> = {
  api: StorageApi
  key: string
  schema?: z.ZodType<T>
}

export type StorageKeyExt<State> = {
  asyncValue: Atom<State | null>
  error: Atom<StorageError | null>
}

/** Reactive value of a single key over StorageApi.subscribe. */
export const withStorageKey =
  <Target extends Atom>({
    api,
    key,
    schema,
  }: WithStorageKeyOptions<AtomState<Target>>): Ext<Target, StorageKeyExt<AtomState<Target>>> =>
  (target) => {
    const asyncValue = atom<AtomState<Target> | null>(null, `${target.name}.value`)
    const error = atom<StorageError | null>(null, `${target.name}.error`)

    target.extend(
      withConnectHook(() => {
        return api.subscribe<AtomState<Target>>(
          key,
          wrap((event) => {
            if (event instanceof Error) return error.set(event)
            error.set(null)
            // Apply the same object reference to both atoms so the change hook
            // can identity-match it as a server echo (see the guard below).
            asyncValue.set(event.value)
            target.set(event.value)
          }),
          schema,
        )
      }),
      withChangeHook((state, prevState) => {
        // Echo guard: the connect hook applies server-delivered values via
        // `target.set`, which re-enters this change hook (the change hook fires
        // asynchronously, so a flag set around `target.set` would already be
        // cleared by now). Writing that value back would republish it over SSE
        // and re-deliver it here, looping forever. The connect hook reuses the
        // exact object it stored in `asyncValue`, so an identity match means
        // this change is that echo — skip it. Genuine local mutations always
        // produce a fresh object, so they are never skipped.
        if (Object.is(state, asyncValue())) return
        api.set(key, state, state).then((err) => {
          if (err instanceof Error) {
            error.set(err)
            target.set(prevState)
          }
        })
      }),
    )

    return {
      asyncValue,
      error,
    }
  }

export type WithStorageKeyReadonlyOptions<T> = {
  api: StorageApi
  key: string
  schema?: z.ZodType<T>
  /** Applied when the key is absent/deleted (StorageChange.value === null). */
  fallback: T
}

/**
 * Read-only reactive mirror of a single key over StorageApi.subscribe. Unlike
 * withStorageKey there is NO write-back: the atom never PUTs itself. Use for
 * append-only / server-owned values written via api.append (server-stamped
 * id/ts/ip), never api.set.
 */
export const withStorageKeyReadonly =
  <Target extends Atom>({
    api,
    key,
    schema,
    fallback,
  }: WithStorageKeyReadonlyOptions<AtomState<Target>>): Ext<Target, Record<string, never>> =>
  (target) => {
    target.extend(
      withConnectHook(() =>
        api.subscribe<AtomState<Target>>(
          key,
          wrap((event) => {
            if (event instanceof Error) return
            target.set(event.value ?? fallback)
          }),
          schema,
        ),
      ),
    )
    return {}
  }
